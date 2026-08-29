// Package resp speaks the Redis serialization protocol, so that student code
// connects to 127.0.0.1:6379 with redis.Redis(host="127.0.0.1", port=6379) and
// never learns there is no Redis.
//
// It is the only protocol-specific code on the cache path. Everything it decodes
// becomes an Op, and everything downstream of that is shared with every other
// emulator.
//
// # Both protocol versions, because the default moved
//
// RESP2 was going to be enough. It is not: redis-py 8 defaults to RESP3, sends
// HELLO 3 before anything else, and raises rather than falling back — so a
// RESP2-only emu would need `protocol=2` in the lesson's client, which is the
// shim this whole phase exists to avoid. go-redis opens with HELLO 3 too, though
// it does fall back.
//
// The gap between the two turned out to be three frames rather than a protocol:
// null is _ instead of $-1, a map is % instead of a flattened array, and HELLO
// has to answer with the version it was asked for. Sets, doubles, big numbers,
// verbatim strings, and push frames all belong to commands emu does not have.
// A client that asks for neither 2 nor 3 gets NOPROTO, which is what a Redis too
// old for it says.
package resp

import (
	"errors"
	"net"
	"sync/atomic"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/emulator"
)

// Port is where Redis lives, and the whole point: a lesson's client is
// constructed the way it would be anywhere else.
const Port = 6379

// name is the emulator half of a fault rule's "redis.SET".
const name = "redis"

// A Protocol owns port 6379 and hands out one session per connection.
type Protocol struct {
	// connections is how many sessions are open, which a CONNECT op reports for a
	// rule's `when` clause to gate on.
	connections atomic.Int64
	// handshakes numbers connections, which is all HELLO's client id has to be.
	handshakes atomic.Uint32
}

func New() *Protocol { return &Protocol{} }

func (p *Protocol) Name() string { return name }

func (p *Protocol) Port() int { return Port }

// Accept has no handshake to complete: RESP opens with a command, not a startup
// packet, and there is no authentication to get through. The connection is still
// not a usable one until the CONNECT op has been past the control layer, which is
// what lets a lesson refuse it — so the session reports CONNECT as the first
// thing Next returns, exactly as pgwire does after its startup exchange.
//
// The gauge counts the connections that were already open when this one arrived,
// so `when: {connections_gte: 10}` refuses the eleventh the way a client limit
// does.
func (p *Protocol) Accept(conn net.Conn) (emulator.Session, error) {
	return newSession(conn, p, int(p.connections.Add(1)-1), p.handshakes.Add(1)), nil
}

// errRefused ends a connection the control layer would not let start. The client
// has already been told why in an error reply.
var errRefused = errors.New("resp: the connection was refused by a fault rule")
