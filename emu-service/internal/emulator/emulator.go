// Package emulator is the shape every service emu emulates has in common: a
// protocol that owns a port and decodes frames into Ops, a backend that executes
// them, and one serve loop that puts the control layer between the two.
//
// Adding a protocol means writing a Protocol and a Backend. It never means
// touching this file, which is the point: the control point every operation
// funnels through exists once, not once per emulator.
package emulator

import (
	"encoding/json"
	"net"
	"time"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/control"
)

// KindConnect is the operation every protocol reports when a client finishes
// its handshake, so a lesson can fail a connection as readily as a query.
const KindConnect = "CONNECT"

// A Type is what a backend says a result column holds, in the vocabulary every
// protocol shares. Backends know nothing about Postgres OIDs and protocols know
// nothing about SQLite's dynamic typing; this is the whole overlap.
type Type int

// TypeText is the zero value on purpose: a backend that cannot place a column
// says so by leaving it alone, and every client can read text.
const (
	TypeText Type = iota
	TypeInteger
	TypeFloat
	TypeBool
	TypeTimestamp
	TypeBytes
)

// A Column names and types one column of a result.
type Column struct {
	Name string
	Type Type
}

// A Result is what a backend produced. Rows hold one value per column, with nil
// for SQL NULL; a protocol turns them into whatever its wire format calls them.
type Result struct {
	Columns []Column
	Rows    [][]any
	// Tag is what the client is told the operation did, in the protocol's own
	// words: "SELECT 3".
	Tag string
	// Gauges are what the backend reports about its own state for a rule's `when`
	// clause to read. Nil when it reports nothing.
	Gauges map[string]int
}

// A Protocol owns a port and turns an accepted socket into a Session. It is the
// only protocol-specific code in the process.
type Protocol interface {
	Name() string
	Port() int
	// Accept completes the handshake and returns the session that will decode the
	// connection's operations.
	Accept(net.Conn) (Session, error)
}

// A Session is per-connection, because a protocol's state — prepared statements,
// transaction status — lives and dies with its socket.
type Session interface {
	// Next decodes the next operation, returning io.EOF when the client is done.
	Next() (control.Op, error)
	// Reply writes the result of the operation Next last returned.
	Reply(Result) error
	// Fail writes a protocol-correct error frame for it instead.
	Fail(error) error
	Close() error
}

// A Backend holds one emulated service's state. It hands out an Executor per
// connection because a SQL session's transaction belongs to its connection and
// to nothing else.
type Backend interface {
	// Seed applies the lesson's seed data, in whatever shape this backend reads.
	Seed(json.RawMessage) error
	Open() (Executor, error)
	Close() error
}

// An Executor runs the operations of one connection.
type Executor interface {
	Exec(control.Op) (Result, error)
	// Abort tells the backend the control layer failed an operation instead of
	// running it, so state the operation would have resolved can be undone. A
	// faulted COMMIT has to leave its writes absent, not pending.
	Abort(control.Op)
	Close() error
}

// An Emulator is one service: its protocol and the backend behind it.
type Emulator struct {
	Proto   Protocol
	Backend Backend
}

// Serve answers connections until listener is closed.
func (e *Emulator) Serve(listener net.Listener, intercept *control.Interceptor) {
	for {
		conn, err := listener.Accept()
		if err != nil {
			return // the listener was closed during teardown
		}
		go e.handle(conn, intercept)
	}
}

// handle is the universal loop. Every protocol reuses it verbatim, and the one
// call to Before in the middle of it is the whole control layer.
func (e *Emulator) handle(conn net.Conn, intercept *control.Interceptor) {
	defer func() { _ = conn.Close() }()

	executor, err := e.Backend.Open()
	if err != nil {
		return
	}
	defer func() { _ = executor.Close() }()

	session, err := e.Proto.Accept(conn)
	if err != nil {
		return
	}
	defer func() { _ = session.Close() }()

	for {
		op, err := session.Next()
		if err != nil {
			return
		}
		op.Emulator = e.Proto.Name()

		if !e.step(session, executor, intercept.Before(op), op) {
			return
		}
	}
}

// step carries out one verdict and reports whether the connection lives on.
func (e *Emulator) step(session Session, executor Executor, verdict control.Verdict, op control.Op) bool {
	if verdict.Delay > 0 {
		time.Sleep(verdict.Delay)
	}
	switch {
	case verdict.DropConn:
		return false // the client sees a dead socket, not a protocol error
	case verdict.Err != nil:
		executor.Abort(op)
		return session.Fail(verdict.Err) == nil
	}

	result, err := executor.Exec(op)
	if err != nil {
		return session.Fail(err) == nil
	}
	return session.Reply(result) == nil
}
