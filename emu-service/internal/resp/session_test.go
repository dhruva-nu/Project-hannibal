package resp

import (
	"bufio"
	"encoding/json"
	"errors"
	"net"
	"strings"
	"testing"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/control"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/emulator"
)

// a fixed backend answers every command the same way, so that replies emu should
// never have to produce, and failures no cache would raise, can be produced on
// purpose.
type fixed struct {
	result emulator.Result
	err    error
}

func (b fixed) Seed(json.RawMessage) error       { return nil }
func (b fixed) Open() (emulator.Executor, error) { return b, nil }
func (b fixed) Close() error                     { return nil }
func (b fixed) Abort(control.Op)                 {}

func (b fixed) Exec(op control.Op) (emulator.Result, error) {
	if op.Kind == emulator.KindConnect {
		return emulator.Result{}, nil
	}
	return b.result, b.err
}

// a named failure carries its own Redis prefix, the way kv's errors do.
type named struct{}

func (named) Error() string      { return "the key is not that kind of key" }
func (named) RedisError() string { return "WRONGTYPE the key is not that kind of key" }

// onADeadSocket is a session whose client has already gone, which is the only
// way to reach the paths where writing a reply is what fails.
func onADeadSocket(t *testing.T) *session {
	t.Helper()

	ours, theirs := net.Pipe()
	if err := theirs.Close(); err != nil {
		t.Fatalf("closing the far end: %v", err)
	}
	t.Cleanup(func() { _ = ours.Close() })
	return newSession(ours, New(), 0, 1)
}

func TestAReplyToAClientThatHasGoneIsReported(t *testing.T) {
	session := onADeadSocket(t)

	err := session.Reply(emulator.Result{Tag: "OK"})

	if err == nil {
		t.Error("Reply = nil, want the write reported so the serve loop drops the connection")
	}
}

func TestAFailureToAClientThatHasGoneIsReported(t *testing.T) {
	session := onADeadSocket(t)

	err := session.Fail(errors.New("injected"))

	if err == nil {
		t.Error("Fail = nil, want the write reported rather than the loop carrying on")
	}
}

func TestALineLongerThanTheReadBufferIsRefusedRatherThanHeld(t *testing.T) {
	// A client that never sends a newline would otherwise grow emu's read buffer
	// without limit, and emu is PID 1 in the student's own memory cgroup.
	oversized := strings.NewReader("*" + strings.Repeat("9", 2*readBuffer))

	_, err := readLine(bufio.NewReaderSize(oversized, readBuffer))

	var broken *protocolError
	if !errors.As(err, &broken) || !strings.Contains(err.Error(), "too big inline request") {
		t.Errorf("readLine = %v, want the line refused", err)
	}
}

func TestEmuSaysSoWhenItProducesSomethingThatIsNotARedisReply(t *testing.T) {
	// Unreachable from kv, and that is the point: if the vocabulary in
	// commands.go ever grows a type resp does not know, the client is told
	// instead of left waiting for a frame that is not coming.
	address, _ := serveBackend(t, fixed{result: emulator.Result{Rows: [][]any{{3.5}}}}, nil)

	answered := exchange(t, address, command("GET", "k"))

	if !strings.HasPrefix(answered, "-ERR emu produced a float64") {
		t.Errorf("emu answered %q, want it to name what it could not encode", answered)
	}
}

func TestAResultWithNoValueAtAllIsASimpleString(t *testing.T) {
	address, _ := serveBackend(t, fixed{result: emulator.Result{Rows: [][]any{{}}, Tag: "OK"}}, nil)

	answered := exchange(t, address, command("GET", "k"))

	if answered != "+OK\r\n+OK\r\n" {
		t.Errorf("emu answered %q, want the tag as a simple string", answered)
	}
}

func TestAFailureNamesItselfOrIsReportedAsERR(t *testing.T) {
	for _, failure := range []struct {
		name string
		err  error
		want string
	}{
		{"one that names itself", named{}, "-WRONGTYPE the key is not that kind of key\r\n"},
		{"one that does not", errors.New("emu lost its footing"), "-ERR emu lost its footing\r\n"},
	} {
		t.Run(failure.name, func(t *testing.T) {
			address, _ := serveBackend(t, fixed{err: failure.err}, nil)

			answered := exchange(t, address, command("GET", "k"))

			if answered != failure.want+"+OK\r\n" {
				t.Errorf("emu answered %q, want %q", answered, failure.want)
			}
		})
	}
}
