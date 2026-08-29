// Package mongowire speaks the MongoDB wire protocol, so that student code
// connects to 127.0.0.1:27017 with an ordinary MongoClient and never learns
// that emu's own document store is answering.
//
// It is the only protocol-specific code on the document path. Everything it
// decodes becomes an Op, and everything downstream of that is shared with every
// other emulator.
package mongowire

import (
	"errors"
	"net"
	"sync/atomic"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/emulator"
)

// Port is where MongoDB lives, and the whole point: a lesson's connection string
// is the one it would use anywhere else.
const Port = 27017

// name is the emulator half of a fault rule's "mongo.insert".
const name = "mongo"

// A Counter is what the backend tells the protocol about itself, so that an
// operation can carry a document count to the control layer before anything
// executes. The gauge belongs to the backend and the Op is built on the decode
// side, and this interface is the whole of what that costs.
type Counter interface {
	Count(collection string) int
}

// A Protocol owns port 27017 and hands out one session per connection.
type Protocol struct {
	documents Counter
	// connections is how many sessions are open, which a CONNECT op reports for a
	// rule's `when` clause to gate on.
	connections atomic.Int64
	// handshakes numbers connections, which is all a connectionId has to be:
	// nothing in emu can be cancelled by naming one.
	handshakes atomic.Int32
}

func New(documents Counter) *Protocol { return &Protocol{documents: documents} }

func (p *Protocol) Name() string { return name }

func (p *Protocol) Port() int { return Port }

// Accept returns the session that will decode the connection's commands. There
// is no handshake to complete here: MongoDB's is itself a command, and the
// client speaks first.
func (p *Protocol) Accept(conn net.Conn) (emulator.Session, error) {
	// The gauge counts the connections that were already open when this one
	// arrived, so "connections_gte: 10" refuses the eleventh.
	return newSession(conn, p, int(p.connections.Add(1)-1)), nil
}

// errRefused ends a connection a fault rule would not let start.
//
// A Postgres client has already sent its startup packet by the time emu reports
// the connection, so pgwire can answer a refusal with an error frame. A MongoDB
// client has said nothing at all — the connection is reported the moment the
// socket is accepted, which is the only point at which refusing it is still
// refusing a connection rather than failing a command. So the socket simply
// closes, which is what a driver sees from a server that is out of connections.
var errRefused = errors.New("mongowire: the connection was refused by a fault rule")
