package queues

import (
	"fmt"
	"slices"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/control"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/emulator"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/mq"
)

// generatedConsumerPrefix names a consumer the client did not name, counted
// rather than randomised so two runs of a lesson produce the same op log.
const generatedConsumerPrefix = "amq.ctag-"

// allDeliveries is the delivery tag that means "everything outstanding" in an
// acknowledgement that also set `multiple`.
const allDeliveries uint64 = 0

// A connection is one client's delivery bookkeeping. Delivery tags, the
// messages behind them, and the prefetch each channel is under all belong to
// the connection they were issued on and to nothing else — which is exactly why
// the seam hands out an Executor per connection.
type connection struct {
	backend     *Backend
	nextTag     uint64
	held        map[uint64]*held
	outstanding map[uint16]int
	prefetch    map[uint16]int
	consumers   map[string]*consumer
	generated   int
}

// a held message is one that was delivered and not yet settled. The message
// itself is kept, not just its identity, because a nack that requeues has to
// put the thing back.
type held struct {
	queue   *queue
	message mq.Message
	channel uint16
}

func (c *connection) Exec(op control.Op) (emulator.Result, error) {
	c.backend.mutex.Lock()
	defer c.backend.mutex.Unlock()

	return c.run(op)
}

// run dispatches on the request the codec attached, because a payload's type is
// what says which operation this is. The kinds that need nothing beyond a queue
// name carry no payload and fall through to the second switch.
func (c *connection) run(op control.Op) (emulator.Result, error) {
	switch request := op.Payload.(type) {
	case mq.Exchange:
		return emulator.Result{}, c.backend.declareExchange(op.Target, request.Kind, request.Passive)
	case mq.Declare:
		return c.declare(op.Target, request)
	case mq.Bind:
		return c.bind(op.Target, request)
	case mq.Publish:
		return c.publish(request)
	case mq.Get:
		return c.get(op.Target, request)
	case mq.Consume:
		return c.consume(op.Target, request)
	case mq.Cancel:
		return c.cancel(request)
	case mq.Ack:
		return c.settle(request.Tag, request.Channel, request.Multiple, false)
	case mq.Nack:
		return c.settle(request.Tag, request.Channel, request.Multiple, request.Requeue)
	case mq.Qos:
		return c.qos(request)
	}

	switch op.Kind {
	case emulator.KindConnect:
		return emulator.Result{}, nil
	case mq.KindPurge:
		return c.purge(op.Target)
	case mq.KindDelete:
		return c.remove(op.Target)
	}
	return emulator.Result{}, fmt.Errorf("the queue backend was handed a %q it does not implement", op.Kind)
}

// Abort has nothing to undo. A faulted operation never reached the backend, and
// no queue operation leaves state half-resolved the way an interrupted COMMIT
// does: the message either went into the queue or it did not.
func (c *connection) Abort(control.Op) {}

// Close gives back everything this connection was holding. A worker that dies
// mid-job must not take the job with it, so its unsettled deliveries go to the
// head of their queues and its consumers stop being offered new ones. That is
// what a broker does when a channel drops, and the whole reason acknowledgement
// exists.
func (c *connection) Close() error {
	c.backend.mutex.Lock()
	defer c.backend.mutex.Unlock()

	for _, taking := range c.consumers {
		taking.queue.dropConsumer(taking.tag)
	}
	c.consumers = map[string]*consumer{}

	for tag := range c.held {
		c.give(tag, true)
	}
	for _, target := range c.backend.queues {
		c.backend.dispatch(target)
	}
	return nil
}

func (c *connection) queue(name string) (*queue, error) {
	target, declared := c.backend.queues[name]
	if !declared {
		return nil, noQueue(name)
	}
	return target, nil
}

func (c *connection) declare(name string, request mq.Declare) (emulator.Result, error) {
	target, err := c.backend.declare(name, request)
	if err != nil {
		return emulator.Result{}, err
	}
	// The name is what the client is told, because a queue it left unnamed has
	// one now and every later operation has to use it.
	return emulator.Result{Tag: target.name, Gauges: gaugesOf(target)}, nil
}

func (c *connection) bind(name string, request mq.Bind) (emulator.Result, error) {
	target, err := c.queue(name)
	if err != nil {
		return emulator.Result{}, err
	}
	if err := c.backend.bind(target, request.Exchange, request.RoutingKey); err != nil {
		return emulator.Result{}, err
	}
	return emulator.Result{Gauges: gaugesOf(target)}, nil
}

func (c *connection) purge(name string) (emulator.Result, error) {
	target, err := c.queue(name)
	if err != nil {
		return emulator.Result{}, err
	}
	// Messages already handed to a consumer are not the queue's to throw away;
	// they belong to whoever has not acknowledged them yet.
	removed := len(target.ready)
	target.ready = nil
	return counted(target, removed), nil
}

func (c *connection) remove(name string) (emulator.Result, error) {
	target, err := c.queue(name)
	if err != nil {
		return emulator.Result{}, err
	}
	return counted(target, c.backend.remove(target)), nil
}

func counted(target *queue, removed int) emulator.Result {
	gauges := gaugesOf(target)
	gauges[mq.GaugeRemoved] = removed
	return emulator.Result{Gauges: gauges}
}

func (c *connection) publish(request mq.Publish) (emulator.Result, error) {
	routed, err := c.backend.publish(request.Message)
	if err != nil {
		return emulator.Result{}, err
	}
	gauges := c.backend.gaugesFor(request.Message.Exchange, request.Message.RoutingKey)
	gauges[mq.GaugeRouted] = routed
	return emulator.Result{Gauges: gauges}, nil
}

// get is the pull half of AMQP: one message, now, rather than a subscription. A
// queue with nothing in it is not a failure, so the empty result the codec turns
// into Basic.Get-Empty carries no message rather than an error.
func (c *connection) get(name string, request mq.Get) (emulator.Result, error) {
	target, err := c.queue(name)
	if err != nil {
		return emulator.Result{}, err
	}
	if len(target.ready) == 0 {
		return emulator.Result{Gauges: gaugesOf(target)}, nil
	}

	waiting := target.ready[0]
	target.ready = target.ready[1:]
	tag := c.hold(target, waiting.message, request.Channel, request.NoAck)

	result := mq.Fetched(mq.Delivery{
		Message:     waiting.message,
		Queue:       name,
		Tag:         tag,
		Channel:     request.Channel,
		NoAck:       request.NoAck,
		Redelivered: waiting.redelivered,
		Remaining:   len(target.ready),
	})
	result.Gauges = gaugesOf(target)
	return result, nil
}

func (c *connection) consume(name string, request mq.Consume) (emulator.Result, error) {
	target, err := c.queue(name)
	if err != nil {
		return emulator.Result{}, err
	}
	tag := request.Tag
	if tag == "" {
		c.generated++
		tag = fmt.Sprintf("%s%d", generatedConsumerPrefix, c.generated)
	}
	if _, taken := c.consumers[tag]; taken {
		return emulator.Result{}, failure(codeNotAllowed, "consumer tag %q is already in use on this connection", tag)
	}

	taking := &consumer{
		tag: tag, queue: target, owner: c, sink: request.Sink,
		channel: request.Channel, noAck: request.NoAck,
	}
	c.consumers[tag] = taking
	target.consumers = append(target.consumers, taking)
	c.backend.dispatch(target)

	return emulator.Result{Tag: tag, Gauges: gaugesOf(target)}, nil
}

func (c *connection) cancel(request mq.Cancel) (emulator.Result, error) {
	taking, running := c.consumers[request.Tag]
	if !running {
		return emulator.Result{}, failure(codeNotFound, "no consumer %q on this connection", request.Tag)
	}
	delete(c.consumers, request.Tag)
	taking.queue.dropConsumer(request.Tag)
	return emulator.Result{Tag: request.Tag, Gauges: gaugesOf(taking.queue)}, nil
}

func (c *connection) qos(request mq.Qos) (emulator.Result, error) {
	c.prefetch[request.Channel] = request.Prefetch
	// A prefetch that just grew may have made room for messages already waiting.
	for _, taking := range c.consumers {
		c.backend.dispatch(taking.queue)
	}
	return emulator.Result{}, nil
}

// settle finishes with a delivery, or with every unsettled delivery up to it on
// the same channel when the client said `multiple`. Requeued messages go back;
// the rest are gone.
func (c *connection) settle(tag uint64, channel uint16, multiple, requeue bool) (emulator.Result, error) {
	tags, err := c.selected(tag, channel, multiple)
	if err != nil {
		return emulator.Result{}, err
	}

	var last *queue
	for _, settling := range tags {
		last = c.give(settling, requeue)
		c.backend.dispatch(last)
	}
	return emulator.Result{Gauges: gaugesOf(last)}, nil
}

// selected is which deliveries an acknowledgement names. Tag zero with
// `multiple` means every one outstanding on the channel, which is how a client
// settles a batch it did not count.
func (c *connection) selected(tag uint64, channel uint16, multiple bool) ([]uint64, error) {
	if !multiple {
		if _, outstanding := c.held[tag]; !outstanding {
			return nil, failure(codePreconditionFailed, "unknown delivery tag %d", tag)
		}
		return []uint64{tag}, nil
	}

	var tags []uint64
	for candidate, holding := range c.held {
		if holding.channel == channel && (tag == allDeliveries || candidate <= tag) {
			tags = append(tags, candidate)
		}
	}
	// Sorted so that requeueing a batch puts it back in the order it went out.
	slices.Sort(tags)
	slices.Reverse(tags)
	return tags, nil
}

// give releases one held delivery, optionally putting the message back at the
// head of its queue. The caller holds the backend's mutex.
func (c *connection) give(tag uint64, requeue bool) *queue {
	holding := c.held[tag]
	delete(c.held, tag)
	c.outstanding[holding.channel]--
	holding.queue.unacked--
	if requeue {
		holding.queue.requeue(holding.message)
	}
	return holding.queue
}

// hold issues a delivery tag and, unless the client asked not to acknowledge,
// records the message as outstanding until it does. The caller holds the
// backend's mutex.
func (c *connection) hold(target *queue, message mq.Message, channel uint16, noAck bool) uint64 {
	c.nextTag++
	if !noAck {
		c.held[c.nextTag] = &held{queue: target, message: message, channel: channel}
		c.outstanding[channel]++
		target.unacked++
	}
	return c.nextTag
}

// push hands one message to a consumer and puts the delivery in that
// connection's sink, which its session writes out. The caller holds the
// backend's mutex, and may be another connection's publisher.
func (c *connection) push(taking *consumer, waiting pending) {
	tag := c.hold(taking.queue, waiting.message, taking.channel, taking.noAck)
	taking.sink.Deliver(mq.Delivery{
		Message:     waiting.message,
		Queue:       taking.queue.name,
		Tag:         tag,
		Consumer:    taking.tag,
		Channel:     taking.channel,
		NoAck:       taking.noAck,
		Redelivered: waiting.redelivered,
		Remaining:   len(taking.queue.ready),
	})
}

func (c *connection) hasRoom(channel uint16) bool {
	limit := c.prefetch[channel]
	return limit == 0 || c.outstanding[channel] < limit
}
