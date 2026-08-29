// Package control is the seam every emulator sits behind.
//
// An emulator decodes a client's frame into an Op, hands it to the interceptor,
// and honours the Verdict it gets back. Emulators know nothing about faults, and
// the interceptor knows nothing about wire protocols; this file is the whole
// vocabulary they share.
package control

import "time"

// An Op is one operation an emulator has been asked to perform, decoded far
// enough for a rule to reason about it. Decoding is not optional: to fail the
// third COMMIT the control layer has to know the frame *is* a COMMIT, which a
// raw byte tap cannot tell you.
type Op struct {
	// Emulator is the service that received it, e.g. "postgres".
	Emulator string
	// Kind is the operation within that service, e.g. "COMMIT".
	Kind string
	// Target is what the operation acts on — a key, table, or queue name. It is
	// recorded in the op log and is otherwise free-form.
	Target string
	// Gauges are counters the backend reports about its own state, which a rule's
	// `when` clause tests: a queue publishes {"depth": 100}. Nil for emulators
	// that report nothing, in which case no `when` rule can fire.
	Gauges map[string]int
}

// Name is what a rule's `match` pattern is compared against.
func (o Op) Name() string { return o.Emulator + "." + o.Kind }

// A Verdict is what the interceptor decided about one Op. The zero Verdict means
// "proceed untouched", so an emulator with no rules armed pays nothing.
//
// Delay is applied first, then DropConn, then Err; a backend only executes when
// none of the three is set.
type Verdict struct {
	// Delay is how long to stall before going further.
	Delay time.Duration
	// DropConn closes the connection without a reply, so the client sees a dead
	// socket rather than a protocol error.
	DropConn bool
	// Err is returned to the client as a protocol-correct error frame, and the
	// backend never sees the operation.
	Err error
	// Fault names the actions that fired, joined by "+", for the op log. Empty
	// when the operation was left alone.
	Fault string
}
