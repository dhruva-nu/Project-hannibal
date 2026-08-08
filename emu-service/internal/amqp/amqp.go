// Package amqp speaks AMQP 0-9-1, so that student code connects to
// 127.0.0.1:5672 with pika and an ordinary ConnectionParameters and never
// learns that the broker is a few maps in the same process.
//
// It is the only protocol-specific code on the queue path. There is no Go
// server-side AMQP library to lean on — every one of them is a client — so the
// framing is hand-rolled, which turns out to be the smaller half of the job:
// the interesting part is that everything decoded here becomes an Op before
// anything happens to it.
package amqp

import (
	"bufio"
	"bytes"
	"fmt"
	"io"
	"net"
	"sync/atomic"
	"time"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/emulator"
)

// Port is where a queue lives, and the whole point: a lesson's connection
// parameters are the ones it would use against a real broker.
const Port = 5672

// name is the emulator half of a fault rule's "queue.publish".
const name = "queue"

// defaultExchange is the empty one every "hello world" lesson publishes on
// without knowing it has an exchange at all. Under it a routing key is a queue
// name, which is why a queue-scoped operation can ask for its gauges the same
// way a publish does.
const defaultExchange = ""

// What emu proposes in Connection.Tune. The client may lower any of them.
const (
	proposedChannelMax uint16 = 2047
	proposedFrameMax   uint32 = 131072
	// proposedHeartbeat is zero, and that is the honest simplification of this
	// phase: emu has nothing to detect with a heartbeat, since a client that
	// went away shows up as a closed socket on the next read and the run is over
	// when the child exits either way. A client that insists on an interval is
	// still served — see pulse — because a client that asked for heartbeats and
	// got none would close the connection mid-lesson.
	proposedHeartbeat uint16 = 0
	// minimumFrameMax is the floor the specification puts on the negotiation.
	minimumFrameMax uint32 = 4096
)

// mechanisms is the authentication emu offers. There is none: the connection
// cannot leave loopback inside a sandbox with no network, and a lesson's
// password would live in the same config file the lesson does. Any credentials
// are accepted, which is what lets a student's connection string say whatever
// the tutorial they are following says.
const (
	mechanisms = "PLAIN"
	locales    = "en_US"
)

// A Meter is what the codec asks the backend about the queues an operation is
// aimed at, *before* the control layer decides anything about it. A depth cap
// has to read the depth the publish would land on, and after execution that
// number has already changed.
type Meter interface {
	Gauges(exchange, routingKey string) map[string]int
}

// A Protocol owns port 5672 and hands out one session per connection.
type Protocol struct {
	meter Meter
	// connections is how many sessions are open, which a CONNECT op reports for
	// a rule's `when` clause to gate on.
	connections atomic.Int64
}

func New(meter Meter) *Protocol { return &Protocol{meter: meter} }

func (p *Protocol) Name() string { return name }

func (p *Protocol) Port() int { return Port }

// Accept completes the connection handshake and returns the session that
// decodes everything after it. Connection.Open-Ok is deliberately withheld: the
// client is not connected until the CONNECT op has been through the control
// layer, which is what lets a lesson refuse a connection outright.
func (p *Protocol) Accept(conn net.Conn) (emulator.Session, error) {
	incoming := bufio.NewReader(conn)
	outgoing := bufio.NewWriter(conn)

	if err := greet(incoming, outgoing); err != nil {
		return nil, err
	}
	agreed, err := negotiate(incoming, outgoing)
	if err != nil {
		return nil, err
	}

	// The gauge counts the connections that were already open when this one
	// arrived, so "connections_gte: 10" refuses the eleventh.
	return newSession(p, incoming, outgoing, agreed, int(p.connections.Add(1)-1)), nil
}

// greet checks the eight bytes a client opens with. A version emu does not
// speak is answered with the one it does and then hung up on, which is the
// specification's own handshake failure and the only way the client can report
// something better than a silence.
func greet(incoming *bufio.Reader, outgoing *bufio.Writer) error {
	offered := make([]byte, len(protocolHeader))
	if _, err := io.ReadFull(incoming, offered); err != nil {
		return err
	}
	if !bytes.Equal(offered, protocolHeader) {
		_, _ = outgoing.Write(protocolHeader)
		_ = outgoing.Flush()
		return fmt.Errorf("amqp: %q is not the AMQP 0-9-1 protocol header", offered)
	}
	return nil
}

// A tuning is what the two sides agreed the connection's limits are.
type tuning struct {
	frameMax  uint32
	heartbeat time.Duration
}

// negotiate runs Start / Start-Ok / Tune / Tune-Ok and reads the client's
// Connection.Open, stopping one message short of a usable connection.
func negotiate(incoming *bufio.Reader, outgoing *bufio.Writer) (tuning, error) {
	start := encode(connectionStart)
	// The version fields carry 0.9, not the 0.9.1 of the protocol header: the
	// revision has never been part of this method and pika checks both.
	start.octet(0)
	start.octet(9)
	start.table(serverProperties())
	start.longstr([]byte(mechanisms))
	start.longstr([]byte(locales))
	handshakeSend(outgoing, frame{kind: frameMethod, payload: start.out})

	// Whatever the client says its credentials are, they are accepted. A
	// greeting that could not be written is a client that has gone, and the read
	// below is where that is reported.
	if _, err := expect(incoming, connectionStartOk); err != nil {
		return tuning{}, err
	}

	tune := encode(connectionTune)
	tune.short(proposedChannelMax)
	tune.long(proposedFrameMax)
	tune.short(proposedHeartbeat)
	handshakeSend(outgoing, frame{kind: frameMethod, payload: tune.out})

	agreed, err := accepted(incoming)
	if err != nil {
		return tuning{}, err
	}
	if _, err := expect(incoming, connectionOpen); err != nil {
		return tuning{}, err
	}
	return agreed, nil
}

// accepted reads Connection.Tune-Ok, where the client either takes what emu
// proposed or lowers it.
func accepted(incoming *bufio.Reader) (tuning, error) {
	tuned, err := expect(incoming, connectionTuneOk)
	if err != nil {
		return tuning{}, err
	}
	tuned.short() // channel-max, which emu enforces from its own proposal
	frameMax := tuned.long()
	heartbeat := tuned.short()
	if !tuned.done() {
		return tuning{}, fmt.Errorf("amqp: Connection.Tune-Ok ran off the end of its frame")
	}

	if frameMax != 0 && frameMax < minimumFrameMax {
		return tuning{}, fmt.Errorf("amqp: a %d byte frame maximum is under the %d the protocol allows", frameMax, minimumFrameMax)
	}
	if frameMax == 0 || frameMax > proposedFrameMax {
		frameMax = proposedFrameMax
	}
	// A heartbeat timeout is what the peer will wait before declaring the
	// connection dead, so the frames themselves go out at half of it.
	return tuning{frameMax: frameMax, heartbeat: time.Duration(heartbeat) * time.Second / 2}, nil
}

// expect reads the one method the handshake is waiting for. There is nothing
// else a client may send at these points, so anything else ends the connection
// rather than being queued for later.
func expect(incoming *bufio.Reader, wanted methodID) (*reader, error) {
	received, err := readFrame(incoming, proposedFrameMax)
	if err != nil {
		return nil, err
	}
	if received.kind != frameMethod || received.channel != 0 {
		return nil, fmt.Errorf("amqp: the handshake got a type %d frame on channel %d", received.kind, received.channel)
	}

	id, arguments := decode(received.payload)
	if id != wanted {
		return nil, fmt.Errorf("amqp: the handshake got method %d.%d, wanting %d.%d",
			id.class(), id.method(), wanted.class(), wanted.method())
	}
	return arguments, nil
}

// handshakeSend writes without reporting: a greeting that cannot be written is
// a client that has already gone, and the next read is where that surfaces.
func handshakeSend(outgoing *bufio.Writer, sending frame) {
	_, _ = outgoing.Write(encodeFrame(sending))
	_ = outgoing.Flush()
}

// serverProperties is what emu says about itself. The capabilities are the part
// a client acts on, and they are stated honestly: publisher confirms work,
// consumer cancel notification does not, so a client that would rely on being
// told its queue was deleted knows not to.
func serverProperties() []byte {
	capabilities := &fields{}
	capabilities.flag("publisher_confirms", true)
	capabilities.flag("basic.nack", true)
	capabilities.flag("consumer_cancel_notify", false)

	properties := &fields{}
	properties.text("product", "emu")
	properties.text("platform", "Go")
	properties.text("information", "an emulated broker — see plans/emu-service.md")
	properties.nested("capabilities", capabilities)
	return properties.out
}
