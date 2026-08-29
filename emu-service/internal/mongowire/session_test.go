package mongowire

import (
	"errors"
	"io"
	"net"
	"strings"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/control"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/emulator"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/mongocmd"
)

// The driver tests next door prove a real client is satisfied. These are the
// frames a driver does not send often enough to be caught that way, and the
// answers emu owes a client that sends one anyway.

// countsNothing is a Counter for the tests that have no store behind them.
type countsNothing struct{}

func (countsNothing) Count(string) int { return 0 }

func dial(t *testing.T, address string) net.Conn {
	t.Helper()

	conn, err := net.Dial("tcp", address)
	if err != nil {
		t.Fatalf("dialling: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	if err := conn.SetDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatalf("setting a deadline: %v", err)
	}
	return conn
}

func ask(t *testing.T, conn net.Conn, opCode int32, payload []byte) {
	t.Helper()

	if _, err := conn.Write(framed(opCode, payload)); err != nil {
		t.Fatalf("writing: %v", err)
	}
}

func hear(t *testing.T, conn net.Conn) (header, bson.D) {
	t.Helper()

	message, payload, err := readMessage(conn)
	if err != nil {
		t.Fatalf("reading a reply: %v", err)
	}
	document, _, err := decodeMsg(payload)
	if message.opCode == opReply {
		const preamble = 20
		document, _, err = takeDocument(payload[preamble:])
	}
	if err != nil {
		t.Fatalf("decoding a reply: %v", err)
	}
	return message, document
}

// A driver cannot know a server accepts OP_MSG until it has asked, and the
// asking is itself a command — so the first hello arrives the legacy way and has
// to be answered the legacy way.
func TestTheLegacyHandshakeIsAnsweredOnTheOpcodeItArrivedOn(t *testing.T) {
	address, _ := serve(t, "", nil)
	conn := dial(t, address)

	command := encoded(t, bson.D{mongocmd.Field("isMaster", int32(1))})
	payload := append([]byte{0, 0, 0, 0}, append([]byte("admin.$cmd"), 0)...)
	payload = append(payload, make([]byte, 8)...)
	ask(t, conn, opQuery, append(payload, command...))

	message, reply := hear(t, conn)

	if message.opCode != opReply {
		t.Errorf("the handshake was answered on opcode %d, want %d", message.opCode, opReply)
	}
	if writable, _ := mongocmd.Lookup(reply, "ismaster"); writable != true {
		t.Errorf("reply = %v, want the field the command it answers is named after", reply)
	}
	// helloOk is what tells the driver it may stop using OP_QUERY.
	if permitted, _ := mongocmd.Lookup(reply, "helloOk"); permitted != true {
		t.Errorf("reply = %v, want helloOk", reply)
	}
	if version, _ := mongocmd.Lookup(reply, "maxWireVersion"); version != int32(maxWireVersion) {
		t.Errorf("reply = %v, want maxWireVersion %d", reply, maxWireVersion)
	}
}

func TestHelloIsAnsweredWithTheNameThatGoesWithIt(t *testing.T) {
	address, _ := serve(t, "", nil)
	conn := dial(t, address)

	ask(t, conn, opMsg, body(bodySection(encoded(t, bson.D{mongocmd.Field("hello", int32(1))}))))
	_, reply := hear(t, conn)

	if writable, _ := mongocmd.Lookup(reply, "isWritablePrimary"); writable != true {
		t.Errorf("reply = %v, want isWritablePrimary", reply)
	}
	if _, legacy := mongocmd.Lookup(reply, "ismaster"); legacy {
		t.Errorf("reply = %v, want the legacy name left out", reply)
	}
}

// An unacknowledged write is not replied to, and the next command's answer must
// not arrive in its place.
func TestAnUnacknowledgedWriteIsNotRepliedTo(t *testing.T) {
	address, _ := serve(t, "", nil)
	conn := dial(t, address)

	insert := body(
		bodySection(encoded(t, bson.D{mongocmd.Field("insert", "orders"), mongocmd.Field("$db", "shop")})),
		sequenceSection("documents", encoded(t, bson.D{mongocmd.Field("sku", "a")})),
	)
	insert[0] = flagMoreToCome
	ask(t, conn, opMsg, insert)
	ask(t, conn, opMsg, body(bodySection(encoded(t, bson.D{mongocmd.Field("count", "orders"), mongocmd.Field("$db", "shop")}))))

	_, reply := hear(t, conn)

	if counted, _ := mongocmd.Lookup(reply, "n"); counted != int32(1) {
		t.Errorf("reply = %v, want the count and not an answer to the insert", reply)
	}
}

// An opcode emu does not speak cannot be answered in a way the client would
// understand, and a reply on the wrong one is worse than a closed socket.
func TestAnOpcodeEmuDoesNotSpeakEndsTheConnection(t *testing.T) {
	address, _ := serve(t, "", nil)
	conn := dial(t, address)

	ask(t, conn, 2012, []byte{1, 2, 3, 4})

	if _, _, err := readMessage(conn); !errors.Is(err, io.EOF) {
		t.Errorf("readMessage = %v, want the connection closed", err)
	}
}

// A MongoDB client has said nothing at all when its connection is reported, so
// there is no frame to refuse it in — which is also what a driver sees from a
// server that is out of connections.
func TestARefusedConnectionIsAClosedSocket(t *testing.T) {
	address, log := serve(t, "", []control.Rule{{Match: "mongo.CONNECT", Action: control.ActionError}})
	conn := dial(t, address)

	_, _, err := readMessage(conn)

	if !errors.Is(err, io.EOF) {
		t.Errorf("readMessage = %v, want the connection closed with nothing said", err)
	}
	if entries := log.Entries(); len(entries) != 1 || entries[0].Fault != "error" {
		t.Errorf("the op log = %v, want the refused connection recorded", entries)
	}
}

// piped is a session with a socket and no serve loop behind it, for the answers
// that only emu's own mistakes could provoke.
func piped(t *testing.T) (*session, net.Conn) {
	t.Helper()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listening: %v", err)
	}
	defer func() { _ = listener.Close() }()

	accepted := make(chan net.Conn, 1)
	go func() {
		conn, _ := listener.Accept()
		accepted <- conn
	}()

	client := dial(t, listener.Addr().String())
	server := <-accepted
	t.Cleanup(func() { _ = server.Close() })

	return newSession(server, New(countsNothing{}), 0), client
}

// A result that is not a reply document is emu contradicting itself, and the
// client is told so rather than left waiting.
func TestAResultThatIsNotAReplyBecomesAnErrorTheClientCanSee(t *testing.T) {
	sess, client := piped(t)

	if err := sess.Reply(emulator.Result{}); err != nil {
		t.Fatalf("Reply = %v", err)
	}
	_, reply := hear(t, client)

	if ok, _ := mongocmd.Lookup(reply, "ok"); ok != 0.0 {
		t.Errorf("reply = %v, want a failure", reply)
	}
	if code, _ := mongocmd.Lookup(reply, "code"); code != int32(mongocmd.CodeUnknown) {
		t.Errorf("reply = %v, want %d", reply, mongocmd.CodeUnknown)
	}
}

func TestAReplyThatCannotBeEncodedIsReportedRatherThanSentHalfway(t *testing.T) {
	sess, _ := piped(t)

	err := sess.send(bson.D{mongocmd.Field("unencodable", make(chan int))})

	if err == nil || !strings.Contains(err.Error(), "encoding a reply") {
		t.Errorf("send = %v, want the encoding blamed", err)
	}
}

func TestNothingIsWrittenForAConnectionOrForASilentRequest(t *testing.T) {
	sess, _ := piped(t)
	sess.connecting = true

	if err := sess.Reply(mongocmd.Reply(bson.D{})); err != nil {
		t.Errorf("Reply during CONNECT = %v", err)
	}
	if err := sess.Fail(errors.New("refused")); !errors.Is(err, errRefused) {
		t.Errorf("Fail during CONNECT = %v, want it to end the connection", err)
	}

	sess.connecting, sess.pending.silent = false, true
	if err := sess.send(bson.D{mongocmd.Field("ok", 1.0)}); err != nil {
		t.Errorf("send to a client that is not reading = %v", err)
	}
}

// A driver parses a non-numeric code as zero and reads zero as success, so a
// rule that spells the failure rather than numbering it gets it back as the
// codeName instead.
func TestARulesCodeIsReadAsMongoDBNumbersItsErrors(t *testing.T) {
	for _, want := range []struct {
		rule string
		code int
		name string
	}{
		{"", mongocmd.CodeWriteConflict, "WriteConflict"},
		{"10107", 10107, ""},
		{"NotWritablePrimary", mongocmd.CodeWriteConflict, "NotWritablePrimary"},
	} {
		code, name := codeOf(&control.FaultError{Code: want.rule, Message: "injected"})

		if code != want.code || name != want.name {
			t.Errorf("code %q = %d %q, want %d %q", want.rule, code, name, want.code, want.name)
		}
	}
}

// A connection that closes gives its slot back, so a rule gated on how many are
// open counts what is open rather than what ever was.
func TestClosingAConnectionGivesItsSlotBack(t *testing.T) {
	protocol := New(countsNothing{})
	client, server := net.Pipe()
	defer func() { _ = client.Close() }()

	first, err := protocol.Accept(server)
	if err != nil {
		t.Fatalf("Accept = %v", err)
	}
	if protocol.connections.Load() != 1 {
		t.Errorf("one connection reports %d open", protocol.connections.Load())
	}
	if err := first.Close(); err != nil || protocol.connections.Load() != 0 {
		t.Errorf("Close = %v, leaving %d open", err, protocol.connections.Load())
	}
}
