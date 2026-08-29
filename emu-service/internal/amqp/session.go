package amqp

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"maps"
	"slices"
	"strconv"
	"time"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/control"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/emulator"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/mq"
)

// The AMQP reply codes emu produces itself. A backend failure brings its own —
// see queues — and this is what is left: the client did something emu cannot
// follow, or a rule failed an operation without saying how.
const (
	codeNoRoute         uint16 = 312
	codeFrameError      uint16 = 501
	codeSyntaxError     uint16 = 502
	codeCommandInvalid  uint16 = 503
	codeChannelError    uint16 = 504
	codeUnexpectedFrame uint16 = 505
	codeNotImplemented  uint16 = 540
	codeInternalError   uint16 = 541
	// defaultFaultCode is what an injected fault carries when the rule did not
	// name a code. AMQP has no equivalent of a serialization failure that
	// clients retry on their own, so the honest default is "the broker could not
	// do this for want of resources" — which is exactly what a depth cap is.
	defaultFaultCode uint16 = 506
)

// errRefused ends a connection the control layer would not let start. The
// client has already been told why in a Connection.Close.
var errRefused = errors.New("amqp: the connection was refused by a fault rule")

// emptyProperties is the two zero octets a content header must carry even when
// the publisher set no properties at all.
var emptyProperties = []byte{0, 0}

// A channel is one AMQP channel's protocol state. Queues and messages are the
// backend's; this is only what the client believes about its own channel.
type channel struct {
	// closing is set when emu sent Channel.Close and is waiting for the client's
	// Close-Ok. Everything else arriving on the channel until then is discarded,
	// which is what the specification asks for and what stops a fault from
	// turning into a stream of errors.
	closing  bool
	confirms bool
	// published counts this channel's publishes, which in confirm mode is the
	// sequence number the client matches an acknowledgement against.
	published uint64
	// consumers maps a consumer tag to the queue it is on, so that a Basic.Cancel
	// names a queue and a channel's teardown knows what to cancel.
	consumers map[string]string
}

// A task is one operation on its way to the control layer, together with what
// answering it owes the client.
type task struct {
	op      control.Op
	channel uint16
	// cause is the client method the operation came from, which a channel
	// exception has to name so that the client knows what it was refused for.
	cause methodID
	// answer is the method a success is reported with, or noReply for the
	// asynchronous half of AMQP.
	answer methodID
}

// A publishing is a Basic.Publish that has not finished arriving. A published
// message is three frames — the method, the content header, and the body — and
// there is no operation to hand over until all of them are in.
type publishing struct {
	channel   uint16
	message   mq.Message
	mandatory bool
	bodySize  uint64
}

// A session decodes one connection. It is per-connection because channels,
// publisher confirms, and the delivery tags a client is holding all live and
// die with the socket.
type session struct {
	protocol *Protocol
	incoming *bufio.Reader
	outgoing *bufio.Writer
	agreed   tuning

	// frames is fed by a reader goroutine, because Next has to be able to wake
	// on a delivery as readily as on a client frame and a socket read cannot be
	// selected on.
	frames  chan frame
	failure error
	done    chan struct{}
	beats   *time.Ticker

	channels map[uint16]*channel
	staged   []task
	active   task
	pending  *publishing

	deliveries *outbox
	// fromQueue remembers which queue a delivery tag came from, so that the
	// acknowledgement of it names a queue a rule can match on. The messages
	// themselves stay in the backend; this is one string per unsettled delivery.
	fromQueue map[uint64]string

	alreadyOpen int
	greeted     bool
}

func newSession(protocol *Protocol, incoming *bufio.Reader, outgoing *bufio.Writer, agreed tuning, alreadyOpen int) *session {
	live := &session{
		protocol:    protocol,
		incoming:    incoming,
		outgoing:    outgoing,
		agreed:      agreed,
		frames:      make(chan frame),
		done:        make(chan struct{}),
		channels:    map[uint16]*channel{},
		deliveries:  newOutbox(),
		fromQueue:   map[uint64]string{},
		alreadyOpen: alreadyOpen,
	}
	if agreed.heartbeat > 0 {
		live.beats = time.NewTicker(agreed.heartbeat)
	}
	go live.read()
	return live
}

// read is the only thing that touches the socket for input. It stops when the
// session is closed, so a connection that ends mid-frame leaves no goroutine
// parked on a send nobody will receive.
func (s *session) read() {
	defer close(s.frames)

	for {
		received, err := readFrame(s.incoming, s.agreed.frameMax)
		if err != nil {
			s.failure = err
			return
		}
		select {
		case s.frames <- received:
		case <-s.done:
			return
		}
	}
}

// Next decodes until it has an operation for the control layer, answering the
// protocol messages that are not operations and writing out any deliveries the
// backend has decided this connection should receive.
func (s *session) Next() (control.Op, error) {
	if !s.greeted {
		s.greeted = true
		s.active = s.connectTask()
		return s.active.op, nil
	}

	for {
		if len(s.staged) > 0 {
			s.active, s.staged = s.staged[0], s.staged[1:]
			return s.active.op, nil
		}
		if err := s.deliver(); err != nil {
			return control.Op{}, err
		}

		select {
		case received, alive := <-s.frames:
			if !alive {
				return control.Op{}, s.failure
			}
			if err := s.receive(received); err != nil {
				return control.Op{}, err
			}
		case <-s.deliveries.woken:
		case <-s.pulse():
			s.send(frame{kind: frameHeartbeat})
			// A heartbeat that cannot be written is a client that has gone, and
			// the read at the top of the next turn is where that is reported.
			_ = s.flush()
		}
	}
}

// Reply answers the operation Next last returned.
func (s *session) Reply(result emulator.Result) error {
	s.track(result)

	switch s.active.answer {
	case noReply:
		return s.async(result)
	case basicGetOk:
		return s.fetched(result)
	}
	s.send(frame{kind: frameMethod, channel: s.active.channel, payload: s.answer(result)})
	return s.flush()
}

// Fail tells the client the operation did not happen, in the only way AMQP has:
// a channel exception. The channel is dead afterwards, which is what a broker
// does for every error a client can cause and what makes the failure impossible
// to miss — a publish is asynchronous, so a client in confirm mode learns of it
// while waiting for the confirm, and one that is not learns at its next
// synchronous call.
func (s *session) Fail(err error) error {
	if s.active.op.Kind == emulator.KindConnect {
		s.send(closure(0, connectionClose, replyCodeOf(err), err.Error(), s.active.cause))
		_ = s.flush()
		return errRefused // a refused connection does not become a usable one
	}

	number := s.active.channel
	open, live := s.channels[number]
	switch {
	case live && open.closing:
		// The client has already been told this channel is finished and is on its
		// way to saying Close-Ok. A second exception would be emu talking over
		// itself — this happens when a rule faults one of the cancellations a
		// channel's teardown staged.
		return nil
	case live:
		open.closing = true
		s.cancelConsumers(number, open)
	}
	s.send(closure(number, channelClose, replyCodeOf(err), err.Error(), s.active.cause))
	return s.flush()
}

func (s *session) Close() error {
	close(s.done)
	if s.beats != nil {
		s.beats.Stop()
	}
	s.protocol.connections.Add(-1)
	return nil
}

// connectTask is the operation a completed handshake reports. It carries the
// queue gauges like every other operation and, like Postgres does, how deep the
// pool already was — so a lesson can refuse the eleventh connection.
func (s *session) connectTask() task {
	gauges := s.protocol.meter.Gauges(defaultExchange, "")
	gauges["connections"] = s.alreadyOpen
	return task{
		op:     control.Op{Kind: emulator.KindConnect, Gauges: gauges},
		cause:  connectionOpen,
		answer: connectionOpenOk,
	}
}

// pulse is when the next heartbeat is due, or a channel that never fires when
// the negotiation settled on none.
func (s *session) pulse() <-chan time.Time {
	if s.beats == nil {
		return nil
	}
	return s.beats.C
}

func (s *session) receive(received frame) error {
	switch received.kind {
	case frameHeartbeat:
		// Nothing to answer. emu holds no deadline against a client: a client
		// that went away is a closed socket on the next read.
		return nil
	case frameMethod:
		id, arguments := decode(received.payload)
		return s.method(received.channel, id, arguments)
	case frameHeader:
		return s.contentHeader(received)
	case frameBody:
		return s.contentBody(received)
	}
	return s.fatal(codeFrameError, noMethod, "frame type %d is not one AMQP has", received.kind)
}

func (s *session) method(number uint16, id methodID, arguments *reader) error {
	if number == 0 {
		return s.connectionMethod(id)
	}
	if id == channelOpen {
		return s.openChannel(number)
	}

	open, exists := s.channels[number]
	switch {
	case !exists:
		return s.fatal(codeChannelError, id, "channel %d was never opened", number)
	case id == channelCloseOk:
		delete(s.channels, number)
		return nil
	case open.closing:
		return nil // everything after emu's Channel.Close waits for the Close-Ok
	case id == channelClose:
		return s.closeChannel(number, open)
	}
	return s.operation(number, id, arguments)
}

func (s *session) connectionMethod(id methodID) error {
	switch id {
	case connectionClose:
		s.send(frame{kind: frameMethod, payload: encode(connectionCloseOk).out})
		_ = s.flush()
		return io.EOF
	case connectionCloseOk:
		return io.EOF
	}
	return s.fatal(codeCommandInvalid, id, "method %d.%d is not one channel 0 accepts", id.class(), id.method())
}

func (s *session) openChannel(number uint16) error {
	switch {
	case number > proposedChannelMax:
		return s.fatal(codeChannelError, channelOpen, "channel %d is past the %d emu offered", number, proposedChannelMax)
	case s.channels[number] != nil:
		return s.fatal(codeChannelError, channelOpen, "channel %d is already open", number)
	}

	s.channels[number] = &channel{consumers: map[string]string{}}
	opened := encode(channelOpenOk)
	opened.longstr(nil)
	s.send(frame{kind: frameMethod, channel: number, payload: opened.out})
	return s.flush()
}

// closeChannel answers the client at once and cancels what the channel was
// consuming afterwards. The client is not waiting on those cancellations and
// the channel is already gone, so putting them first would only keep the
// consumers alive for longer.
func (s *session) closeChannel(number uint16, open *channel) error {
	delete(s.channels, number)
	s.send(frame{kind: frameMethod, channel: number, payload: encode(channelCloseOk).out})
	s.cancelConsumers(number, open)
	return s.flush()
}

// cancelConsumers stages a cancellation per consumer, in tag order so that two
// runs of a lesson produce the same op log.
func (s *session) cancelConsumers(number uint16, open *channel) {
	for _, tag := range slices.Sorted(maps.Keys(open.consumers)) {
		s.stage(task{
			op: control.Op{
				Kind:    mq.KindCancel,
				Target:  open.consumers[tag],
				Payload: mq.Cancel{Tag: tag},
			},
			channel: number,
			cause:   channelClose,
			answer:  noReply,
		})
	}
	open.consumers = map[string]string{}
}

// unsupported refuses a method emu never implemented. Saying so beats silence:
// a client waiting for a reply that will never come hangs until the sandbox
// times the run out, and the student sees nothing at all.
func (s *session) unsupported(number uint16, id methodID) error {
	s.channels[number].closing = true
	s.send(closure(number, channelClose, codeNotImplemented,
		fmt.Sprintf("emu does not implement method %d.%d", id.class(), id.method()), id))
	return s.flush()
}

// fatal ends the connection with a reason. A connection exception is what AMQP
// has for a client emu can no longer follow — a frame it cannot parse, an
// operation on a channel that was never opened — and the alternative, carrying
// on, is a broker pretending to have understood.
func (s *session) fatal(code uint16, cause methodID, format string, args ...any) error {
	reason := fmt.Sprintf(format, args...)
	s.send(closure(0, connectionClose, code, reason, cause))
	_ = s.flush()
	return errors.New("amqp: " + reason)
}

// stage hands the serve loop an operation, with the gauges a rule may read
// about the queues it is aimed at. They are read here rather than taken from
// the result, because the control layer decides before the backend runs and by
// then the answer has already changed — which is the whole point of a cap.
func (s *session) stage(next task) {
	next.op.Gauges = s.gauges(next.op)
	s.staged = append(s.staged, next)
}

// decoded stages an operation once it is sure the method it came from was all
// there. A frame that ran short is a client emu cannot follow, and guessing at
// arguments it did not send is worse than saying so.
func (s *session) decoded(in *reader, next task) error {
	if !in.done() {
		return s.fatal(codeSyntaxError, next.cause, "method %d.%d ran off the end of its frame",
			next.cause.class(), next.cause.method())
	}
	s.stage(next)
	return nil
}

func (s *session) gauges(op control.Op) map[string]int {
	if published, publishing := op.Payload.(mq.Publish); publishing {
		return s.protocol.meter.Gauges(published.Message.Exchange, published.Message.RoutingKey)
	}
	return s.protocol.meter.Gauges(defaultExchange, op.Target)
}

// track follows what the client believes it has running, which is what a
// channel's teardown has to cancel and what an acknowledgement's Op names.
func (s *session) track(result emulator.Result) {
	open, live := s.channels[s.active.channel]
	if !live {
		return
	}
	switch s.active.op.Kind {
	case mq.KindConsume:
		open.consumers[result.Tag] = s.active.op.Target
	case mq.KindCancel:
		delete(open.consumers, result.Tag)
	}
}

// answer builds the reply the client is waiting for. The methods that carry
// nothing back beyond "done" fall through to the last line.
func (s *session) answer(result emulator.Result) []byte {
	out := encode(s.active.answer)
	switch s.active.answer {
	case connectionOpenOk:
		out.shortstr("")
	case queueDeclareOk:
		out.shortstr(result.Tag)
		out.long(uint32(result.Gauges[mq.GaugeDepth]))
		out.long(uint32(result.Gauges[mq.GaugeConsumers]))
	case queuePurgeOk, queueDeleteOk:
		out.long(uint32(result.Gauges[mq.GaugeRemoved]))
	case basicConsumeOk, basicCancelOk:
		out.shortstr(result.Tag)
	}
	return out.out
}

// async answers the methods AMQP gives no reply to. A publish still owes the
// client something when it asked for one: the message back when it routed
// nowhere and said `mandatory`, and a Basic.Ack when the channel is in confirm
// mode — which is the only way a publisher ever hears that a publish worked.
func (s *session) async(result emulator.Result) error {
	if s.active.op.Kind != mq.KindPublish {
		return nil
	}

	published, _ := s.active.op.Payload.(mq.Publish)
	if published.Mandatory && result.Gauges[mq.GaugeRouted] == 0 {
		s.returnMessage(published.Message)
	}
	s.confirm()
	return s.flush()
}

// confirm acknowledges a publish on a channel in confirm mode. The sequence
// number is the publish's position on that channel, counted from one, which is
// what the client matches its own outstanding publishes against.
func (s *session) confirm() {
	open, live := s.channels[s.active.channel]
	if !live || !open.confirms {
		return
	}
	open.published++

	out := encode(basicAck)
	out.longlong(open.published)
	out.flags(false) // multiple: emu confirms one publish at a time
	s.send(frame{kind: frameMethod, channel: s.active.channel, payload: out.out})
}

func (s *session) returnMessage(message mq.Message) {
	out := encode(basicReturn)
	out.short(codeNoRoute)
	out.shortstr("NO_ROUTE")
	out.shortstr(message.Exchange)
	out.shortstr(message.RoutingKey)
	s.send(frame{kind: frameMethod, channel: s.active.channel, payload: out.out})
	s.sendContent(s.active.channel, message)
}

// fetched answers a Basic.Get. An empty queue is not a failure, so the result
// with no message in it becomes Get-Empty rather than a channel exception.
func (s *session) fetched(result emulator.Result) error {
	delivery, found := mq.Fetch(result)
	if !found {
		empty := encode(basicGetEmpty)
		empty.shortstr("")
		s.send(frame{kind: frameMethod, channel: s.active.channel, payload: empty.out})
		return s.flush()
	}

	out := encode(basicGetOk)
	out.longlong(delivery.Tag)
	out.flags(delivery.Redelivered)
	out.shortstr(delivery.Message.Exchange)
	out.shortstr(delivery.Message.RoutingKey)
	out.long(uint32(delivery.Remaining))
	s.send(frame{kind: frameMethod, channel: s.active.channel, payload: out.out})
	s.sendContent(s.active.channel, delivery.Message)
	s.remember(delivery)
	return s.flush()
}

// deliver writes out whatever the backend pushed at this connection since the
// last look.
func (s *session) deliver() error {
	pushed := s.deliveries.take()
	if len(pushed) == 0 {
		return nil
	}
	for _, delivery := range pushed {
		s.sendDelivery(delivery)
	}
	return s.flush()
}

func (s *session) sendDelivery(delivery mq.Delivery) {
	open, live := s.channels[delivery.Channel]
	if !live || open.closing {
		// The channel went away between the backend choosing this consumer and
		// the session writing to it. The message is still unacknowledged, so it
		// returns to its queue when the connection ends.
		return
	}

	out := encode(basicDeliver)
	out.shortstr(delivery.Consumer)
	out.longlong(delivery.Tag)
	out.flags(delivery.Redelivered)
	out.shortstr(delivery.Message.Exchange)
	out.shortstr(delivery.Message.RoutingKey)
	s.send(frame{kind: frameMethod, channel: delivery.Channel, payload: out.out})
	s.sendContent(delivery.Channel, delivery.Message)
	s.remember(delivery)
}

// remember notes which queue a delivery came from, but only while the client
// still owes an acknowledgement for it. A no-ack consumer never settles
// anything, and remembering its deliveries would grow a map for the life of the
// connection.
func (s *session) remember(delivery mq.Delivery) {
	if !delivery.NoAck {
		s.fromQueue[delivery.Tag] = delivery.Queue
	}
}

// forget drops what a settled acknowledgement was being remembered for.
func (s *session) forget(tag uint64, multiple bool) {
	if !multiple {
		delete(s.fromQueue, tag)
		return
	}
	for held := range s.fromQueue {
		if tag == 0 || held <= tag {
			delete(s.fromQueue, held)
		}
	}
}

// sendContent writes the two or more frames a message is: the content header
// carrying its properties exactly as they arrived, then the body split to fit
// whatever frame size the connection settled on.
func (s *session) sendContent(number uint16, message mq.Message) {
	properties := message.Properties
	if len(properties) == 0 {
		properties = emptyProperties
	}

	header := &writer{}
	header.short(basicClass)
	header.short(0) // weight, which the specification has never used
	header.longlong(uint64(len(message.Body)))
	header.raw(properties)
	s.send(frame{kind: frameHeader, channel: number, payload: header.out})

	limit := int(s.agreed.frameMax) - frameOverhead
	for start := 0; start < len(message.Body); start += limit {
		s.send(frame{kind: frameBody, channel: number, payload: message.Body[start:min(start+limit, len(message.Body))]})
	}
}

func (s *session) send(sending frame) { _, _ = s.outgoing.Write(encodeFrame(sending)) }

func (s *session) flush() error { return s.outgoing.Flush() }

// closure builds a Connection.Close or a Channel.Close, which have the same
// four arguments: why, in words and in a number a client can branch on, and
// which method it was that could not be carried out.
func closure(number uint16, id methodID, code uint16, reason string, cause methodID) frame {
	out := encode(id)
	out.short(code)
	out.shortstr(reason)
	out.short(cause.class())
	out.short(cause.method())
	return frame{kind: frameMethod, channel: number, payload: out.out}
}

// replyCodeOf is what the client is told, which is what lets a lesson branch on
// the failure rather than parse a sentence. A rule may name any of AMQP's reply
// codes; anything that is not one of those numbers leaves emu's default.
func replyCodeOf(err error) uint16 {
	var fault *control.FaultError
	if errors.As(err, &fault) {
		code, numeric := strconv.ParseUint(fault.Code, 10, 16)
		if numeric == nil && code > 0 {
			return uint16(code)
		}
		return defaultFaultCode
	}

	var coded interface{ ReplyCode() uint16 }
	if errors.As(err, &coded) {
		return coded.ReplyCode()
	}
	return codeInternalError
}
