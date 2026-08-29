// Package pgwire speaks the PostgreSQL frontend/backend protocol, so that
// student code connects to 127.0.0.1:5432 with psycopg and an ordinary
// connection string and never learns that SQLite is answering.
//
// It is the only protocol-specific code on the SQL path. Everything it decodes
// becomes an Op, and everything downstream of that is shared with every other
// emulator.
package pgwire

import (
	"errors"
	"fmt"
	"net"
	"sync/atomic"

	"github.com/jackc/pgx/v5/pgproto3"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/emulator"
)

// Port is where Postgres lives, and the whole point: a lesson's connection
// string is the one it would use anywhere else.
const Port = 5432

// name is the emulator half of a fault rule's "postgres.COMMIT".
const name = "postgres"

// serverVersion is what a client is told it connected to. Drivers switch
// behaviour on it, so it has to be a version that exists; the suffix is where
// real servers put their packaging and where emu puts the truth.
const serverVersion = "16.0 (emu)"

// declined is the single byte that refuses an SSL or GSS negotiation. psycopg
// defaults to sslmode=prefer and will always ask.
var declined = []byte{'N'}

// A Protocol owns port 5432 and hands out one session per connection.
type Protocol struct {
	// connections is how many sessions are open, which a CONNECT op reports for a
	// rule's `when` clause to gate on.
	connections atomic.Int64
	// handshakes numbers connections, which is all a backend key needs to be:
	// query cancellation is not implemented, so the key identifies and no more.
	handshakes atomic.Uint32
}

// cancelKey is the four bytes protocol 3.0 requires a backend key to carry. A
// client would send them back to cancel a running query; emu has no query long
// enough to cancel, so the same constant serves every connection and a client
// that omits it is refused by its own driver rather than by emu.
var cancelKey = []byte{0, 0, 0, 0}

func New() *Protocol { return &Protocol{} }

func (p *Protocol) Name() string { return name }

func (p *Protocol) Port() int { return Port }

// Accept completes the startup exchange and returns the session that decodes the
// connection's statements. ReadyForQuery is deliberately not sent here: the
// client is not connected until the CONNECT op has been through the control
// layer, which is what lets a lesson refuse a connection outright.
func (p *Protocol) Accept(conn net.Conn) (emulator.Session, error) {
	backend := pgproto3.NewBackend(conn, conn)

	startup, err := negotiate(backend, conn)
	if err != nil {
		return nil, err
	}

	backend.Send(&pgproto3.AuthenticationOk{})
	for _, status := range statusReport(startup) {
		backend.Send(status)
	}
	backend.Send(&pgproto3.BackendKeyData{ProcessID: p.handshakes.Add(1), SecretKey: cancelKey})
	// As above: a greeting that cannot be written is a client that has gone, and
	// the session's first read is where it surfaces.
	_ = backend.Flush()

	// The gauge is what a rule reads, and it counts the connections that were
	// already open when this one arrived — so "connections_gte: 10" refuses the
	// eleventh, the way a connection limit does.
	return newSession(backend, p, int(p.connections.Add(1)-1)), nil
}

// negotiate answers the encryption requests that come before the startup packet.
// emu refuses both: the connection never leaves the loopback interface inside a
// sandbox with no network, so encrypting it would cost handshake code and buy
// nothing.
func negotiate(backend *pgproto3.Backend, conn net.Conn) (*pgproto3.StartupMessage, error) {
	for {
		message, err := backend.ReceiveStartupMessage()
		if err != nil {
			return nil, err
		}
		switch typed := message.(type) {
		case *pgproto3.StartupMessage:
			return typed, nil
		case *pgproto3.SSLRequest, *pgproto3.GSSEncRequest:
			// A refusal that cannot be written is a client that has already gone,
			// and the read at the top of the next turn is where that is reported.
			_, _ = conn.Write(declined)
		default:
			// A CancelRequest opens its own connection and expects nothing back.
			return nil, fmt.Errorf("pgwire: %T is not a connection", message)
		}
	}
}

// statusReport is what the server volunteers about itself before the client may
// speak. A driver reads its encoding and its date format out of these, so
// leaving them out means the client guesses.
func statusReport(startup *pgproto3.StartupMessage) []pgproto3.BackendMessage {
	settings := map[string]string{
		"server_version":              serverVersion,
		"server_encoding":             "UTF8",
		"client_encoding":             "UTF8",
		"DateStyle":                   "ISO, MDY",
		"IntervalStyle":               "postgres",
		"TimeZone":                    "UTC",
		"integer_datetimes":           "on",
		"standard_conforming_strings": "on",
		"is_superuser":                "off",
		"application_name":            startup.Parameters["application_name"],
		"session_authorization":       startup.Parameters["user"],
	}

	// Ordered, so that two runs of the same lesson produce the same bytes.
	order := []string{
		"application_name", "client_encoding", "DateStyle", "integer_datetimes",
		"IntervalStyle", "is_superuser", "server_encoding", "server_version",
		"session_authorization", "standard_conforming_strings", "TimeZone",
	}
	report := make([]pgproto3.BackendMessage, 0, len(order))
	for _, key := range order {
		report = append(report, &pgproto3.ParameterStatus{Name: key, Value: settings[key]})
	}
	return report
}

// errRefused ends a connection the control layer would not let start. The client
// has already been told why in an ErrorResponse.
var errRefused = errors.New("pgwire: the connection was refused by a fault rule")
