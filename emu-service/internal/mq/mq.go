// Package mq is the vocabulary a queue protocol and a queue backend share: a
// message, a delivery, and the requests one hands the other.
//
// It exists for the reason sqltext does on the SQL path. The codec has to say
// what it decoded and the engine has to say what it produced, and neither
// should have to import the other to do it.
package mq

import "github.com/dhruva-nu/Project-hannibal/emu-service/internal/emulator"

// The operations a rule matches, as "queue.<kind>". They are the AMQP method
// names with the class dropped wherever that leaves them unambiguous, because
// "queue.publish" is what a lesson author would write without being told.
const (
	KindPublish  = "publish"
	KindGet      = "get"
	KindConsume  = "consume"
	KindCancel   = "cancel"
	KindAck      = "ack"
	KindNack     = "nack"
	KindQos      = "qos"
	KindDeclare  = "declare"
	KindBind     = "bind"
	KindPurge    = "purge"
	KindDelete   = "delete"
	KindExchange = "exchange_declare"
)

// The gauges the backend reports. Depth is the one this whole emulator exists
// to make available: {"match": "queue.publish", "when": {"depth_gte": 100}} is
// how a lesson says a queue holds a hundred messages.
const (
	GaugeDepth     = "depth"
	GaugeUnacked   = "unacked"
	GaugeConsumers = "consumers"
	// GaugeRouted is how many queues a publish reached, which is not state a
	// rule reads but what tells the codec whether a mandatory message has to go
	// back to its publisher.
	GaugeRouted = "routed"
	// GaugeRemoved is how many messages a purge or a delete threw away.
	GaugeRemoved = "removed"
)

// A Message is what a publisher handed over. Properties are the content
// header's property block exactly as it arrived: emu has no reason to look
// inside one, and carrying the bytes through is both smaller than a codec for
// fourteen optional fields and lossless in a way that codec would not be.
type Message struct {
	Exchange   string
	RoutingKey string
	Properties []byte
	Body       []byte
}

// A Delivery is one message on its way to a client, whether a consumer was
// pushed it or a Basic.Get pulled it.
type Delivery struct {
	Message Message
	Queue   string
	// Tag identifies the delivery until it is acknowledged. It is unique for the
	// life of a connection rather than only of a channel — a stronger guarantee
	// than AMQP asks for, and one map rather than one per channel.
	Tag uint64
	// Consumer is the tag Basic.Consume was answered with, empty for a Get.
	Consumer string
	Channel  uint16
	// NoAck says the client will never settle this delivery, so nothing about it
	// needs remembering once it has been written out.
	NoAck       bool
	Redelivered bool
	// Remaining is how many messages were left behind this one, which
	// Basic.Get-Ok reports and nothing else reads.
	Remaining int
}

// A Sink is where the backend puts a message it has decided to push at a
// consumer. Deliver must not block: the connection that published is not the
// connection that consumes, and one slow reader must never stall a publisher.
type Sink interface{ Deliver(Delivery) }

// The payloads a decoded Op carries. Anything an operation needs beyond these
// is in the Op itself — Target is the queue it acts on, or the routing key for
// a publish, which under the default exchange is the same thing.
type (
	// Publish carries the message. Mandatory asks for it back if it routes
	// nowhere, which is the only way a publisher learns that it did.
	Publish struct {
		Message   Message
		Mandatory bool
	}

	// Get is a client pulling one message rather than being pushed them.
	Get struct {
		Channel uint16
		NoAck   bool
	}

	// Consume registers a push consumer. The Sink belongs to the session, which
	// is the only thing allowed to write to the socket.
	Consume struct {
		Tag     string
		Sink    Sink
		Channel uint16
		NoAck   bool
	}

	// Cancel unregisters one.
	Cancel struct{ Tag string }

	// Ack settles a delivery. Multiple settles every unacknowledged delivery up
	// to and including Tag on the same channel.
	Ack struct {
		Tag      uint64
		Channel  uint16
		Multiple bool
	}

	// Nack refuses one, optionally putting it back at the head of its queue.
	Nack struct {
		Tag      uint64
		Channel  uint16
		Multiple bool
		Requeue  bool
	}

	// Qos limits how many deliveries a channel may hold unacknowledged.
	Qos struct {
		Channel  uint16
		Prefetch int
	}

	// Declare creates a queue, or with Passive only asserts that it exists.
	Declare struct{ Passive bool }

	// Bind routes an exchange's matching messages into the Op's queue.
	Bind struct {
		Exchange   string
		RoutingKey string
	}

	// Exchange declares an exchange of the given kind.
	Exchange struct {
		Kind    string
		Passive bool
	}
)

// Fetched is how a Basic.Get's message rides back through the Result every
// backend returns. A Result is a table of values, and one message is one cell
// of one row — which beats growing the seam all four emulators share a field
// that only this one would ever read.
func Fetched(delivery Delivery) emulator.Result {
	return emulator.Result{
		Columns: []emulator.Column{{Name: "message", Type: emulator.TypeBytes}},
		Rows:    [][]any{{delivery}},
	}
}

// Fetch reads that message back out. It reports false for an empty queue, which
// is a Basic.Get-Empty rather than a failure.
func Fetch(result emulator.Result) (Delivery, bool) {
	if len(result.Rows) == 0 {
		return Delivery{}, false
	}
	delivery, carried := result.Rows[0][0].(Delivery)
	return delivery, carried
}
