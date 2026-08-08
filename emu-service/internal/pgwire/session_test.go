package pgwire

import (
	"net"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgproto3"
)

// The tests here speak the protocol by hand, for the frames a driver is too
// well-behaved to send: a row-limited Execute, a Close, a message emu never
// implemented. A server is judged as much on what it does with those as on the
// happy path.

// a client is a raw frontend that has finished its handshake.
type client struct {
	t        *testing.T
	conn     net.Conn
	frontend *pgproto3.Frontend
}

func dial(t *testing.T, address string) *client {
	t.Helper()

	conn, err := net.Dial("tcp", address)
	if err != nil {
		t.Fatalf("dialling: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	if err := conn.SetDeadline(time.Now().Add(10 * time.Second)); err != nil {
		t.Fatalf("setting a deadline: %v", err)
	}

	frontend := pgproto3.NewFrontend(conn, conn)
	frontend.Send(&pgproto3.StartupMessage{
		ProtocolVersion: pgproto3.ProtocolVersionNumber,
		Parameters:      map[string]string{"user": "app", "database": "app"},
	})
	client := &client{t: t, conn: conn, frontend: frontend}
	client.flush()
	client.readUntilReady()
	return client
}

func (c *client) flush() {
	c.t.Helper()

	if err := c.frontend.Flush(); err != nil {
		c.t.Fatalf("flushing: %v", err)
	}
}

func (c *client) receive() pgproto3.BackendMessage {
	c.t.Helper()

	message, err := c.frontend.Receive()
	if err != nil {
		c.t.Fatalf("receiving: %v", err)
	}
	return message
}

// readUntilReady collects everything up to and including the ReadyForQuery that
// ends an exchange.
func (c *client) readUntilReady() []pgproto3.BackendMessage {
	c.t.Helper()

	var received []pgproto3.BackendMessage
	for {
		message := c.receive()
		received = append(received, message)
		if _, ready := message.(*pgproto3.ReadyForQuery); ready {
			return received
		}
	}
}

func errorIn(messages []pgproto3.BackendMessage) *pgproto3.ErrorResponse {
	for _, message := range messages {
		if failure, isError := message.(*pgproto3.ErrorResponse); isError {
			return failure
		}
	}
	return nil
}

func TestARowLimitedExecuteIsRefusedRatherThanQuietlyIgnored(t *testing.T) {
	// A client that asked for two rows and got everything would sit waiting for a
	// PortalSuspended that is never coming.
	address, _ := serve(t, []string{"CREATE TABLE t (id INT)", "INSERT INTO t VALUES (1), (2), (3)"}, nil)
	client := dial(t, address)

	client.frontend.Send(&pgproto3.Parse{Query: "SELECT id FROM t"})
	client.frontend.Send(&pgproto3.Bind{})
	client.frontend.Send(&pgproto3.Execute{MaxRows: 2})
	client.frontend.Send(&pgproto3.Sync{})
	client.flush()

	failure := errorIn(client.readUntilReady())
	if failure == nil || failure.Code != "0A000" {
		t.Errorf("failure = %#v, want emu to say it cannot limit a result", failure)
	}
}

func TestClosingAStatementOrAPortalIsAcknowledged(t *testing.T) {
	address, _ := serve(t, []string{"CREATE TABLE t (id INT)"}, nil)
	client := dial(t, address)

	client.frontend.Send(&pgproto3.Parse{Name: "s", Query: "SELECT id FROM t"})
	client.frontend.Send(&pgproto3.Bind{DestinationPortal: "p", PreparedStatement: "s"})
	client.frontend.Send(&pgproto3.Close{ObjectType: 'P', Name: "p"})
	client.frontend.Send(&pgproto3.Close{ObjectType: 'S', Name: "s"})
	client.frontend.Send(&pgproto3.Sync{})
	client.flush()

	closed := 0
	for _, message := range client.readUntilReady() {
		if _, complete := message.(*pgproto3.CloseComplete); complete {
			closed++
		}
	}
	if closed != 2 {
		t.Errorf("%d close acknowledgements, want one each", closed)
	}
}

func TestFlushSendsWhatIsWaitingWithoutEndingTheExchange(t *testing.T) {
	address, _ := serve(t, []string{"CREATE TABLE t (id INT)"}, nil)
	client := dial(t, address)

	client.frontend.Send(&pgproto3.Parse{Query: "SELECT id FROM t"})
	client.frontend.Send(&pgproto3.Flush{})
	client.flush()

	if _, parsed := client.receive().(*pgproto3.ParseComplete); !parsed {
		t.Error("Flush did not deliver what was already written")
	}

	client.frontend.Send(&pgproto3.Sync{})
	client.flush()
	if _, ready := client.receive().(*pgproto3.ReadyForQuery); !ready {
		t.Error("the exchange did not survive the flush")
	}
}

func TestAMessageEmuNeverImplementedEndsTheConnectionRatherThanPretending(t *testing.T) {
	address, _ := serve(t, nil, nil)
	client := dial(t, address)

	client.frontend.Send(&pgproto3.CopyFail{Message: "nothing was copying"})
	client.flush()

	failure := errorIn([]pgproto3.BackendMessage{client.receive()})
	if failure == nil || failure.Code != "0A000" {
		t.Fatalf("failure = %#v, want emu to say it does not implement that", failure)
	}
	if _, err := client.frontend.Receive(); err == nil {
		t.Error("the connection carried on after a message emu cannot follow")
	}
}

func TestBindingAndDescribingWhatDoesNotExistIsRefused(t *testing.T) {
	for name, testCase := range map[string]struct {
		send  []pgproto3.FrontendMessage
		state string
	}{
		"binding a statement that was never parsed": {
			[]pgproto3.FrontendMessage{&pgproto3.Bind{PreparedStatement: "absent"}},
			"26000",
		},
		"describing a statement that was never parsed": {
			[]pgproto3.FrontendMessage{&pgproto3.Describe{ObjectType: 'S', Name: "absent"}},
			"26000",
		},
		"describing a portal that was never bound": {
			[]pgproto3.FrontendMessage{&pgproto3.Describe{ObjectType: 'P', Name: "absent"}},
			"34000",
		},
		"executing a portal that was never bound": {
			[]pgproto3.FrontendMessage{&pgproto3.Execute{Portal: "absent"}},
			"34000",
		},
	} {
		t.Run(name, func(t *testing.T) {
			address, _ := serve(t, nil, nil)
			client := dial(t, address)

			for _, message := range testCase.send {
				client.frontend.Send(message)
			}
			client.frontend.Send(&pgproto3.Sync{})
			client.flush()

			failure := errorIn(client.readUntilReady())
			if failure == nil || failure.Code != testCase.state {
				t.Errorf("failure = %#v, want %s", failure, testCase.state)
			}
		})
	}
}

func TestEverythingAfterAnExtendedFailureIsDiscardedUntilSync(t *testing.T) {
	address, log := serve(t, []string{"CREATE TABLE t (id INT)"}, nil)
	client := dial(t, address)

	client.frontend.Send(&pgproto3.Parse{Name: "s", Query: "INSERT INTO t VALUES (1)"})
	client.frontend.Send(&pgproto3.Bind{PreparedStatement: "absent"}) // fails
	client.frontend.Send(&pgproto3.Bind{PreparedStatement: "s"})      // must be ignored
	client.frontend.Send(&pgproto3.Execute{})                         // and so must this
	client.frontend.Send(&pgproto3.Sync{})
	client.flush()

	if failure := errorIn(client.readUntilReady()); failure == nil {
		t.Fatal("the bad Bind was accepted")
	}
	for _, entry := range log.Entries() {
		if entry.Op == "INSERT" {
			t.Error("a statement after the failure still ran")
		}
	}
}

func TestAFailedStatementInAnExtendedExchangeLeavesTheBlockAborted(t *testing.T) {
	address, _ := serve(t, []string{"CREATE TABLE t (id INT)"}, nil)
	client := dial(t, address)

	client.frontend.Send(&pgproto3.Query{String: "BEGIN"})
	client.flush()
	client.readUntilReady()

	client.frontend.Send(&pgproto3.Parse{Query: "SELECT id FROM nope"})
	client.frontend.Send(&pgproto3.Bind{})
	client.frontend.Send(&pgproto3.Describe{ObjectType: 'P'})
	client.frontend.Send(&pgproto3.Execute{})
	client.frontend.Send(&pgproto3.Sync{})
	client.flush()

	received := client.readUntilReady()
	if failure := errorIn(received); failure == nil {
		t.Fatal("a missing table did not fail")
	}
	ready := received[len(received)-1].(*pgproto3.ReadyForQuery)
	if ready.TxStatus != statusAborted {
		t.Errorf("transaction status = %q, want %q", ready.TxStatus, statusAborted)
	}
}

func TestTheTransactionStatusIsWhatTheClientIsTold(t *testing.T) {
	address, _ := serve(t, []string{"CREATE TABLE t (id INT)"}, nil)
	client := dial(t, address)

	for _, step := range []struct {
		sql    string
		status byte
	}{
		{"SELECT id FROM t", statusIdle},
		{"BEGIN", statusInBlock},
		{"INSERT INTO t VALUES (1)", statusInBlock},
		{"COMMIT", statusIdle},
		{"BEGIN", statusInBlock},
		{"SELECT id FROM nope", statusAborted},
		{"ROLLBACK", statusIdle},
	} {
		client.frontend.Send(&pgproto3.Query{String: step.sql})
		client.flush()

		received := client.readUntilReady()
		ready := received[len(received)-1].(*pgproto3.ReadyForQuery)
		if ready.TxStatus != step.status {
			t.Errorf("%s -> status %q, want %q", step.sql, ready.TxStatus, step.status)
		}
	}
}

func TestABeginThatFailsLeavesNoTransactionBehind(t *testing.T) {
	address, _ := serve(t, nil, nil)
	client := dial(t, address)

	// The rule fails the BEGIN itself, so the client must be told it is not in a
	// block rather than left believing it opened one.
	client.frontend.Send(&pgproto3.Query{String: "BEGIN; SELECT 1"})
	client.flush()
	received := client.readUntilReady()

	ready := received[len(received)-1].(*pgproto3.ReadyForQuery)
	if ready.TxStatus != statusInBlock {
		t.Errorf("status = %q, want the block open", ready.TxStatus)
	}
}

func TestASSLRequestIsDeclinedRatherThanIgnored(t *testing.T) {
	address, _ := serve(t, nil, nil)

	conn, err := net.Dial("tcp", address)
	if err != nil {
		t.Fatalf("dialling: %v", err)
	}
	defer func() { _ = conn.Close() }()

	frontend := pgproto3.NewFrontend(conn, conn)
	frontend.Send(&pgproto3.SSLRequest{})
	if err := frontend.Flush(); err != nil {
		t.Fatalf("flushing: %v", err)
	}

	answer := make([]byte, 1)
	if _, err := conn.Read(answer); err != nil {
		t.Fatalf("reading: %v", err)
	}
	if answer[0] != 'N' {
		t.Errorf("answer = %q, want the refusal psycopg expects under sslmode=prefer", answer)
	}
}

func TestSomethingThatIsNotAClientIsTurnedAway(t *testing.T) {
	address, _ := serve(t, nil, nil)

	conn, err := net.Dial("tcp", address)
	if err != nil {
		t.Fatalf("dialling: %v", err)
	}
	defer func() { _ = conn.Close() }()
	if err := conn.SetDeadline(time.Now().Add(10 * time.Second)); err != nil {
		t.Fatalf("setting a deadline: %v", err)
	}

	// A CancelRequest opens its own connection and expects nothing back, so there
	// is nothing for the server to do but hang up.
	frontend := pgproto3.NewFrontend(conn, conn)
	frontend.Send(&pgproto3.CancelRequest{ProcessID: 1, SecretKey: []byte{0, 0, 0, 0}})
	if err := frontend.Flush(); err != nil {
		t.Fatalf("flushing: %v", err)
	}

	if _, err := conn.Read(make([]byte, 1)); err == nil {
		t.Error("the server answered a cancel request")
	}
}

func TestAClientThatHangsUpMidHandshakeIsNoOnesProblem(t *testing.T) {
	address, log := serve(t, nil, nil)

	conn, err := net.Dial("tcp", address)
	if err != nil {
		t.Fatalf("dialling: %v", err)
	}
	if err := conn.Close(); err != nil {
		t.Fatalf("closing: %v", err)
	}

	// Nothing to assert but that the emulator is still answering afterwards.
	dial(t, address)
	if entries := log.Entries(); len(entries) != 1 {
		t.Errorf("op log = %#v, want only the connection that finished", entries)
	}
}

func TestAParameterEmuCannotDecodeStopsTheStatementRatherThanTheGuess(t *testing.T) {
	address, _ := serve(t, []string{"CREATE TABLE t (id INT)"}, nil)
	client := dial(t, address)

	client.frontend.Send(&pgproto3.Parse{Query: "SELECT id FROM t WHERE id = $1", ParameterOIDs: []uint32{1186}})
	client.frontend.Send(&pgproto3.Bind{
		ParameterFormatCodes: []int16{pgproto3.BinaryFormat},
		Parameters:           [][]byte{{0}},
	})
	client.frontend.Send(&pgproto3.Execute{})
	client.frontend.Send(&pgproto3.Sync{})
	client.flush()

	failure := errorIn(client.readUntilReady())
	if failure == nil || failure.Code != "22P03" {
		t.Errorf("failure = %#v, want the parameter reported as unreadable", failure)
	}
}

func TestAStatementWithNoColumnsIsDescribedAsHavingNone(t *testing.T) {
	address, _ := serve(t, []string{"CREATE TABLE t (id INT)"}, nil)
	client := dial(t, address)

	client.frontend.Send(&pgproto3.Parse{Query: "INSERT INTO t VALUES (1)"})
	client.frontend.Send(&pgproto3.Bind{})
	client.frontend.Send(&pgproto3.Describe{ObjectType: 'P'})
	client.frontend.Send(&pgproto3.Execute{})
	client.frontend.Send(&pgproto3.Sync{})
	client.flush()

	saidNothing := false
	for _, message := range client.readUntilReady() {
		if _, none := message.(*pgproto3.NoData); none {
			saidNothing = true
		}
		if _, described := message.(*pgproto3.RowDescription); described {
			t.Error("an INSERT was described as returning columns")
		}
	}
	if !saidNothing {
		t.Error("the portal was described as nothing at all, want an explicit NoData")
	}
}
