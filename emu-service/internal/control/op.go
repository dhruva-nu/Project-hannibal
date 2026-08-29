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
// The JSON tags are the dev control plane's wire format for a synthetic op, not
// something a lesson ever writes.
type Op struct {
	// Emulator is the service that received it, e.g. "postgres".
	Emulator string `json:"emulator"`
	// Kind is the operation within that service, e.g. "COMMIT".
	Kind string `json:"kind"`
	// Target is what the operation acts on — a key, table, or queue name. It is
	// recorded in the op log and is otherwise free-form.
	Target string `json:"target,omitempty"`
	// Gauges are counters the backend reports about its own state, which a rule's
	// `when` clause tests: a queue publishes {"depth": 100}. Nil for emulators
	// that report nothing, in which case no `when` rule can fire.
	Gauges map[string]int `json:"gauges,omitempty"`
	// Payload is what the backend needs to actually perform the operation — for
	// SQL, the statement and its parameters. No rule reads it and it never
	// crosses the control plane, which is why it carries no JSON.
	Payload any `json:"-"`
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

// A FaultError is the failure a rule injected. It carries the rule's Code so the
// emulator can raise the failure its clients actually recognise: a Postgres
// driver turns SQLSTATE 40001 into a serialization failure and retries, while
// the same words with no code are just a string.
//
// Code is empty when the rule did not name one, and the emulator picks the
// failure its protocol is most likely to have to handle.
type FaultError struct {
	Code    string
	Message string
}

func (e *FaultError) Error() string { return e.Message }
