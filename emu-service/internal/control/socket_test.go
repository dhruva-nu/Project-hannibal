package control

import (
	"errors"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/oplog"
)

func TestCtlAddsARuleToAnAlreadyRunningProcess(t *testing.T) {
	// The P1 exit criterion: a rule arrives after the process started, takes
	// effect immediately, and leaves a trace in the op log.
	log := oplog.New(10)
	interceptor := mustArmInto(t, log)
	socket := serve(t, interceptor)

	response, err := Send(socket, Request{
		Command: CommandFaultAdd,
		Rule:    &Rule{Match: "redis.SET", Action: ActionError, Message: "disk full"},
	})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if len(response.Rules) != 1 || response.Rules[0].Match != "redis.SET" {
		t.Errorf("rules = %+v, want the new rule echoed back", response.Rules)
	}
	if verdict := interceptor.Before(Op{Emulator: "redis", Kind: "SET"}); verdict.Err == nil {
		t.Error("the rule was accepted but does not fire")
	}
	if entries := log.Entries(); len(entries) == 0 || entries[0].Control == "" {
		t.Errorf("entries = %+v, want the mutation recorded", entries)
	}
}

func TestCtlListsAndResetsRules(t *testing.T) {
	interceptor := mustArm(t, Rule{Match: "redis.SET", Action: ActionError})
	socket := serve(t, interceptor)

	listed, err := Send(socket, Request{Command: CommandFaultList})
	if err != nil {
		t.Fatalf("fault.list: %v", err)
	}
	if len(listed.Rules) != 1 {
		t.Errorf("rules = %+v, want the armed rule", listed.Rules)
	}

	if _, err := Send(socket, Request{Command: CommandFaultReset}); err != nil {
		t.Fatalf("fault.reset: %v", err)
	}
	if got := interceptor.Rules(); len(got) != 0 {
		t.Errorf("rules = %+v, want none after a reset", got)
	}
}

func TestCtlReadsTheOpLog(t *testing.T) {
	interceptor := mustArm(t)
	interceptor.Before(Op{Emulator: "postgres", Kind: "COMMIT"})
	socket := serve(t, interceptor)

	response, err := Send(socket, Request{Command: CommandOplog})
	if err != nil {
		t.Fatalf("oplog: %v", err)
	}
	if len(response.Oplog) != 1 || response.Oplog[0].Op != "COMMIT" {
		t.Errorf("oplog = %+v, want the recorded commit", response.Oplog)
	}
}

func TestTheServerRefusesRequestsItCannotHonour(t *testing.T) {
	socket := serve(t, mustArm(t))

	for name, testCase := range map[string]struct {
		request Request
		names   string
	}{
		"unknown command":   {Request{Command: "shutdown"}, "shutdown"},
		"add with no rule":  {Request{Command: CommandFaultAdd}, "needs a rule"},
		"a malformed rule":  {Request{Command: CommandFaultAdd, Rule: &Rule{Match: "redis.GET", Action: ActionDelay}}, "ms"},
		"an unknown action": {Request{Command: CommandFaultAdd, Rule: &Rule{Match: "redis.GET", Action: "explode"}}, "explode"},
	} {
		t.Run(name, func(t *testing.T) {
			response, err := Send(socket, testCase.request)
			if err == nil {
				t.Fatal("Send = nil, want the refusal surfaced as an error")
			}
			if !strings.Contains(response.Error, testCase.names) {
				t.Errorf("refusal = %q, want it to name %q", response.Error, testCase.names)
			}
		})
	}
}

func TestOneConnectionCarriesManyRequests(t *testing.T) {
	// The P2 dashboard holds a connection open rather than dialling per action.
	socket := serve(t, mustArm(t))
	conn := dial(t, socket)

	for attempt := range 3 {
		response, err := exchange(conn, Request{Command: CommandFaultList})
		if err != nil {
			t.Fatalf("request %d: %v", attempt+1, err)
		}
		if !response.OK {
			t.Errorf("request %d was refused: %s", attempt+1, response.Error)
		}
	}
}

func TestTheSocketIsOwnerOnlyEvenThoughThatIsNotWhatMakesItSafe(t *testing.T) {
	// 0600 keeps other users out. It does not keep student code out — that shares
	// emu's uid — which is why this socket only ever opens from an argv flag.
	socket := serve(t, mustArm(t))

	info, err := os.Stat(socket)
	if err != nil {
		t.Fatalf("Stat: %v", err)
	}
	if mode := info.Mode().Perm(); mode != 0o600 {
		t.Errorf("mode = %o, want 600", mode)
	}
}

func TestListenRefusesAPathAlreadyInUse(t *testing.T) {
	interceptor := mustArm(t)
	socket := serve(t, interceptor)

	if _, err := Listen(socket, interceptor); err == nil {
		t.Error("Listen = nil, want a second emu on the same socket refused")
	}
}

func TestListenReportsAFailureToRestrictTheSocket(t *testing.T) {
	path := filepath.Join(t.TempDir(), "emu.sock")
	failing := func(string, os.FileMode) error { return errors.New("no such file") }

	if _, err := listen(path, mustArm(t), failing); err == nil {
		t.Fatal("listen = nil, want a socket it cannot restrict refused")
	}
	if _, err := os.Stat(path); err == nil {
		t.Error("the socket file survived a failed Listen")
	}
}

func TestSendReportsAnUnreachableSocket(t *testing.T) {
	_, err := Send(filepath.Join(t.TempDir(), "not-there.sock"), Request{Command: CommandOplog})

	if err == nil {
		t.Fatal("Send = nil, want a dial failure")
	}
	if !strings.Contains(err.Error(), "dialing") {
		t.Errorf("Send = %v, want it to name the dial", err)
	}
}

func TestSendReportsAStreamItCannotWriteTo(t *testing.T) {
	_, err := exchange(brokenStream{}, Request{Command: CommandOplog})

	if err == nil || !strings.Contains(err.Error(), "sending") {
		t.Errorf("exchange = %v, want the write failure reported", err)
	}
}

func TestSendReportsAMissingReply(t *testing.T) {
	// An emu that dies mid-request must not look like a successful no-op.
	socket := filepath.Join(t.TempDir(), "silent.sock")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatalf("Listen: %v", err)
	}
	t.Cleanup(func() { _ = listener.Close() })
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		// Take the request before hanging up. Closing the moment the connection
		// arrives races the client's write instead, and a write that loses that
		// race reports a failure to send rather than the missing reply this test
		// is about — which leaves the reply path untested whenever the race goes
		// the other way.
		_, _ = conn.Read(make([]byte, 1))
		_ = conn.Close()
	}()

	if _, err := Send(socket, Request{Command: CommandOplog}); err == nil {
		t.Error("Send = nil, want the missing reply reported")
	}
}

func TestServeStopsWhenTheSocketCloses(t *testing.T) {
	server, err := Listen(filepath.Join(t.TempDir(), "emu.sock"), mustArm(t))
	if err != nil {
		t.Fatalf("Listen: %v", err)
	}

	stopped := make(chan struct{})
	go func() {
		server.Serve()
		close(stopped)
	}()

	if err := server.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	<-stopped
}

func TestTheServerDropsAConnectionThatSendsNonsense(t *testing.T) {
	socket := serve(t, mustArm(t))
	conn := dial(t, socket)

	if _, err := conn.Write([]byte("this is not json\n")); err != nil {
		t.Fatalf("Write: %v", err)
	}
	if _, err := io.ReadAll(conn); err != nil {
		t.Errorf("ReadAll: %v, want the connection simply closed", err)
	}
}

// dial opens a connection to a control socket, closed when the test ends.
func dial(t *testing.T, socket string) net.Conn {
	t.Helper()
	conn, err := net.Dial("unix", socket)
	if err != nil {
		t.Fatalf("Dial: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	return conn
}

// serve starts a control socket that is closed when the test ends, and returns
// its path.
func serve(t *testing.T, interceptor *Interceptor) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "emu.sock")
	server, err := Listen(path, interceptor)
	if err != nil {
		t.Fatalf("Listen: %v", err)
	}
	t.Cleanup(func() { _ = server.Close() })
	go server.Serve()
	return path
}

type brokenStream struct{}

func (brokenStream) Read([]byte) (int, error)  { return 0, errors.New("closed") }
func (brokenStream) Write([]byte) (int, error) { return 0, errors.New("closed") }
