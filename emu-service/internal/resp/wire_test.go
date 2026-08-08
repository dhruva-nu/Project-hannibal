package resp

import (
	"fmt"
	"io"
	"net"
	"strings"
	"testing"
	"time"
)

// These drive emu with raw frames, because a client library will never send a
// malformed one and the answer to a malformed one is the difference between a
// student reading "Protocol error" and a student watching a socket hang.

func command(words ...string) string {
	var frame strings.Builder
	fmt.Fprintf(&frame, "*%d\r\n", len(words))
	for _, word := range words {
		fmt.Fprintf(&frame, "$%d\r\n%s\r\n", len(word), word)
	}
	return frame.String()
}

// exchange sends raw bytes and returns everything emu wrote back. A QUIT is
// appended so that the server hangs up and the read ends at once; a request that
// makes emu hang up first never gets that far, which is exactly what the
// protocol-error tests are checking.
func exchange(t *testing.T, address, request string) string {
	t.Helper()

	conn, err := net.Dial("tcp", address)
	if err != nil {
		t.Fatalf("dialling: %v", err)
	}
	defer func() { _ = conn.Close() }()

	if err := conn.SetDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatalf("setting the deadline: %v", err)
	}
	if _, err := io.WriteString(conn, request+command("QUIT")); err != nil {
		t.Fatalf("writing: %v", err)
	}

	answered, err := io.ReadAll(conn)
	if err != nil {
		t.Fatalf("reading: %v", err)
	}
	return string(answered)
}

func TestTheCacheIsOnTheCanonicalPortUnderItsOwnName(t *testing.T) {
	protocol := New()

	if protocol.Name() != "redis" || protocol.Port() != 6379 {
		t.Errorf("%s on %d, want redis on 6379", protocol.Name(), protocol.Port())
	}
}

func TestAFrameEmuCannotReadEndsTheConnectionWithAReason(t *testing.T) {
	address, _ := serve(t, "", nil)

	for _, broken := range []struct {
		name    string
		request string
		reason  string
	}{
		{"not an array", "+PING\r\n", "expected '*', got '+'"},
		{"an empty line", "\r\n", "expected '*', got ''"},
		{"a length that is not a number", "*x\r\n", "invalid multibulk length"},
		{"a negative element count", "*-1\r\n", "invalid multibulk length"},
		{"more elements than emu will read", "*2000000\r\n", "invalid multibulk length"},
		{"an element that is not a bulk string", "*1\r\n+PING\r\n", "expected '$', got '+'"},
		{"an element with no length at all", "*1\r\n\r\n", "expected '$', got ''"},
		{"a bulk length that is not a number", "*1\r\n$x\r\n", "invalid bulk length"},
		{"a negative bulk length", "*1\r\n$-1\r\n", "invalid bulk length"},
		{"a bulk bigger than emu will hold", "*1\r\n$9000000\r\n", "invalid bulk length"},
		{"a bulk that does not end where it said", "*1\r\n$4\r\nPINGxx\r\n", "invalid bulk length"},
	} {
		t.Run(broken.name, func(t *testing.T) {
			answered := exchange(t, address, broken.request)

			want := "-ERR Protocol error: " + broken.reason + "\r\n"
			if answered != want {
				t.Errorf("emu answered %q, want %q and nothing after it", answered, want)
			}
		})
	}
}

func TestACommandCutOffPartWayThroughJustEndsTheConnection(t *testing.T) {
	// A half-written frame is a client that died, not one that misbehaved, and
	// there is nobody left to send a protocol error to.
	address, _ := serve(t, "", nil)

	for _, truncated := range []struct {
		name    string
		request string
	}{
		{"in the middle of a bulk string", "*1\r\n$10\r\nab"},
		{"before the next element's header", "*2\r\n$3\r\nGET\r\n"},
	} {
		t.Run(truncated.name, func(t *testing.T) {
			conn, err := net.Dial("tcp", address)
			if err != nil {
				t.Fatalf("dialling: %v", err)
			}
			defer func() { _ = conn.Close() }()
			if _, err := io.WriteString(conn, truncated.request); err != nil {
				t.Fatalf("writing: %v", err)
			}
			if err := conn.(*net.TCPConn).CloseWrite(); err != nil {
				t.Fatalf("half-closing: %v", err)
			}

			answered, err := io.ReadAll(conn)

			if err != nil || len(answered) != 0 {
				t.Errorf("emu answered %q (%v), want nothing said to a client that has gone", answered, err)
			}
		})
	}
}

func TestNestedRepliesSurviveTheEncoder(t *testing.T) {
	address, _ := serve(t, `{"a": "1", "b": "2"}`, nil)

	answered := exchange(t, address, command("SCAN", "0")+command("MGET", "a", "missing"))

	want := "*2\r\n$1\r\n0\r\n*2\r\n$1\r\na\r\n$1\r\nb\r\n" + // the cursor, then the keys
		"*2\r\n$1\r\n1\r\n$-1\r\n" + // a hit and a miss in one array
		"+OK\r\n"
	if answered != want {
		t.Errorf("emu answered %q, want %q", answered, want)
	}
}

func TestAnEmptyFrameIsReadPastRatherThanRefused(t *testing.T) {
	address, _ := serve(t, "", nil)

	answered := exchange(t, address, "*0\r\n"+command("PING"))

	if answered != "+PONG\r\n+OK\r\n" {
		t.Errorf("emu answered %q, want the PING answered and the empty frame ignored", answered)
	}
}

func TestACommandIsReadWhateverCaseItArrivesIn(t *testing.T) {
	address, _ := serve(t, "", nil)

	answered := exchange(t, address, command("set", "k", "v")+command("GeT", "k"))

	if answered != "+OK\r\n$1\r\nv\r\n+OK\r\n" {
		t.Errorf("emu answered %q, want the lower-case commands to have run", answered)
	}
}

func TestQuitIsAcknowledgedBeforeTheConnectionGoes(t *testing.T) {
	address, log := serve(t, "", nil)

	answered := exchange(t, address, "")

	if answered != "+OK\r\n" {
		t.Errorf("emu answered %q, want QUIT acknowledged", answered)
	}
	if entries := log.Entries(); len(entries) != 0 {
		t.Errorf("op log = %#v, want a connection that only said QUIT to have done nothing", entries)
	}
}

func TestTheGreetingSaysWhichProtocolWasAgreed(t *testing.T) {
	address, _ := serve(t, "", nil)

	for _, negotiation := range []struct {
		name    string
		request string
		opening string
	}{
		{"no version at all is RESP2", command("HELLO"), "*14\r\n$6\r\nserver\r\n"},
		{"RESP2 is a flat array", command("HELLO", "2"), "*14\r\n$6\r\nserver\r\n"},
		{"RESP3 is a map", command("HELLO", "3"), "%7\r\n$6\r\nserver\r\n"},
		{"anything else is refused", command("HELLO", "4"), "-NOPROTO unsupported protocol version\r\n"},
	} {
		t.Run(negotiation.name, func(t *testing.T) {
			answered := exchange(t, address, negotiation.request)

			if !strings.HasPrefix(answered, negotiation.opening) {
				t.Errorf("emu answered %q, want it to start %q", answered, negotiation.opening)
			}
		})
	}
}

func TestRESP3ChangesTheNullAndTheMapAndNothingElse(t *testing.T) {
	address, _ := serve(t, `{"session:7": {"user": "ada"}}`, nil)

	older := exchange(t, address, command("GET", "missing")+command("HGETALL", "session:7"))
	newer := exchange(t, address,
		command("HELLO", "3")+command("GET", "missing")+command("HGETALL", "session:7"))

	if !strings.HasSuffix(older, "$-1\r\n*2\r\n$4\r\nuser\r\n$3\r\nada\r\n+OK\r\n") {
		t.Errorf("RESP2 answered %q, want a null bulk string and a flattened map", older)
	}
	if !strings.HasSuffix(newer, "_\r\n%1\r\n$4\r\nuser\r\n$3\r\nada\r\n+OK\r\n") {
		t.Errorf("RESP3 answered %q, want a null frame and a map frame", newer)
	}
}

func TestTheDriversOwnCommandsAreAnsweredWithoutReachingTheCache(t *testing.T) {
	address, log := serve(t, "", nil)

	answered := exchange(t, address,
		command("CLIENT", "SETNAME", "lesson")+
			command("CLIENT", "SETINFO", "LIB-NAME", "redis-py")+
			command("COMMAND", "DOCS"))

	if answered != "+OK\r\n+OK\r\n*0\r\n+OK\r\n" {
		t.Errorf("emu answered %q, want each acknowledged", answered)
	}
	if entries := log.Entries(); len(entries) != 0 {
		t.Errorf("op log = %#v, want the driver's bookkeeping kept out of it", entries)
	}
}

func TestASubcommandEmuDoesNotKnowIsNamedBack(t *testing.T) {
	address, _ := serve(t, "", nil)

	for _, request := range []struct {
		name    string
		frames  string
		expects string
	}{
		{"one it never heard of", command("CLIENT", "KILL"), "'KILL'"},
		{"none at all", command("CLIENT"), "''"},
	} {
		t.Run(request.name, func(t *testing.T) {
			answered := exchange(t, address, request.frames)

			want := "-ERR Unknown subcommand or wrong number of arguments for " +
				request.expects + ". Try CLIENT HELP.\r\n+OK\r\n"
			if answered != want {
				t.Errorf("emu answered %q, want %q", answered, want)
			}
		})
	}
}
