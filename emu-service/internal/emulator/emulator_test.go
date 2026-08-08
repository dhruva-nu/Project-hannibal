package emulator

import (
	"encoding/json"
	"errors"
	"io"
	"net"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/control"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/oplog"
)

// The serve loop is the one piece of emu every emulator shares, so it is tested
// against a protocol and a backend that do nothing but record what they were
// asked — the point is the loop, not what is plugged into it.

type recorder struct {
	mutex sync.Mutex
	ops   []control.Op

	nextErrors  []error
	nextOps     []control.Op
	replies     []Result
	failures    []error
	execResults []Result
	execErrors  []error
	aborted     []control.Op

	acceptErr  error
	openErr    error
	replyErr   error
	failErr    error
	closedSess bool
	closedExec bool
}

func (r *recorder) Name() string { return "fake" }
func (r *recorder) Port() int    { return 0 }

func (r *recorder) Accept(net.Conn) (Session, error) {
	if r.acceptErr != nil {
		return nil, r.acceptErr
	}
	return r, nil
}

func (r *recorder) Next() (control.Op, error) {
	r.mutex.Lock()
	defer r.mutex.Unlock()

	if len(r.nextOps) == 0 {
		return control.Op{}, io.EOF
	}
	op := r.nextOps[0]
	r.nextOps = r.nextOps[1:]

	err := r.nextErrors[0]
	r.nextErrors = r.nextErrors[1:]
	return op, err
}

func (r *recorder) Reply(result Result) error {
	r.mutex.Lock()
	defer r.mutex.Unlock()

	r.replies = append(r.replies, result)
	return r.replyErr
}

func (r *recorder) Fail(err error) error {
	r.mutex.Lock()
	defer r.mutex.Unlock()

	r.failures = append(r.failures, err)
	return r.failErr
}

func (r *recorder) Close() error {
	r.mutex.Lock()
	defer r.mutex.Unlock()

	r.closedSess = true
	return nil
}

// seen reads what the serve loop recorded. It takes the same lock the loop wrote
// under, because a client seeing its socket close is an ordering the race
// detector cannot follow through the kernel.
func (r *recorder) seen() recorded {
	r.mutex.Lock()
	defer r.mutex.Unlock()

	return recorded{
		ops:      slices.Clone(r.ops),
		replies:  slices.Clone(r.replies),
		failures: slices.Clone(r.failures),
		aborted:  slices.Clone(r.aborted),
		closed:   r.closedSess,
	}
}

// recorded is one snapshot of what an emulator was asked to do.
type recorded struct {
	ops      []control.Op
	replies  []Result
	failures []error
	aborted  []control.Op
	closed   bool
}

func (r *recorder) Seed(json.RawMessage) error { return nil }

func (r *recorder) Open() (Executor, error) {
	if r.openErr != nil {
		return nil, r.openErr
	}
	return r, nil
}

func (r *recorder) Exec(op control.Op) (Result, error) {
	r.mutex.Lock()
	defer r.mutex.Unlock()

	r.ops = append(r.ops, op)
	result, err := r.execResults[0], r.execErrors[0]
	r.execResults, r.execErrors = r.execResults[1:], r.execErrors[1:]
	return result, err
}

func (r *recorder) Abort(op control.Op) {
	r.mutex.Lock()
	defer r.mutex.Unlock()

	r.aborted = append(r.aborted, op)
}

// serve runs one connection through the real loop and returns once it is over,
// so a test never has to wait on a goroutine it cannot see.
func serve(t *testing.T, fake *recorder, rules []control.Rule) *oplog.Log {
	t.Helper()

	log := oplog.New(0)
	intercept, err := control.New(rules, log)
	if err != nil {
		t.Fatalf("arming rules: %v", err)
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listening: %v", err)
	}
	defer func() { _ = listener.Close() }()

	emulator := &Emulator{Proto: fake, Backend: fake}
	go emulator.Serve(listener, intercept)

	conn, err := net.Dial("tcp", listener.Addr().String())
	if err != nil {
		t.Fatalf("dialling: %v", err)
	}
	// The loop closes the connection when it is done with it, so reading to EOF
	// is how a test waits for it without sleeping.
	_, _ = io.ReadAll(conn)
	_ = conn.Close()
	return log
}

func ops(kinds ...string) ([]control.Op, []error) {
	made := make([]control.Op, len(kinds))
	errs := make([]error, len(kinds))
	for index, kind := range kinds {
		made[index] = control.Op{Kind: kind}
	}
	return made, errs
}

func results(count int) ([]Result, []error) {
	return make([]Result, count), make([]error, count)
}

func TestEveryOperationReachesTheBackendAndTheOpLog(t *testing.T) {
	fake := &recorder{}
	fake.nextOps, fake.nextErrors = ops("SELECT", "COMMIT")
	fake.execResults, fake.execErrors = results(2)

	log := serve(t, fake, nil)
	seen := fake.seen()

	if len(seen.ops) != 2 || seen.ops[0].Kind != "SELECT" || seen.ops[1].Kind != "COMMIT" {
		t.Fatalf("backend saw %#v, want both operations", seen.ops)
	}
	if seen.ops[0].Emulator != "fake" {
		t.Errorf("emulator = %q, want the protocol's name stamped on", seen.ops[0].Emulator)
	}
	if entries := log.Entries(); len(entries) != 2 {
		t.Errorf("op log = %#v, want one entry per operation", entries)
	}
	if !seen.closed {
		t.Error("the session was not closed")
	}
}

func TestAFaultedOperationNeverReachesTheBackendAndIsAborted(t *testing.T) {
	fake := &recorder{}
	fake.nextOps, fake.nextErrors = ops("COMMIT")
	fake.execResults, fake.execErrors = results(1)

	serve(t, fake, []control.Rule{{Match: "fake.COMMIT", Action: control.ActionError}})
	seen := fake.seen()

	if len(seen.ops) != 0 {
		t.Errorf("backend saw %#v, want nothing: the fault fired first", seen.ops)
	}
	if len(seen.aborted) != 1 || seen.aborted[0].Kind != "COMMIT" {
		t.Errorf("aborted = %#v, want the faulted operation handed back to the backend", seen.aborted)
	}
	if len(seen.failures) != 1 {
		t.Errorf("failures = %#v, want the client told once", seen.failures)
	}
}

func TestABackendFailureIsReportedAndTheConnectionCarriesOn(t *testing.T) {
	fake := &recorder{}
	fake.nextOps, fake.nextErrors = ops("SELECT", "SELECT")
	fake.execResults = []Result{{}, {}}
	fake.execErrors = []error{errors.New("no such table"), nil}

	serve(t, fake, nil)
	seen := fake.seen()

	if len(seen.failures) != 1 || seen.failures[0].Error() != "no such table" {
		t.Errorf("failures = %#v, want the backend's own error", seen.failures)
	}
	if len(seen.replies) != 1 {
		t.Errorf("replies = %#v, want the second operation still answered", seen.replies)
	}
}

func TestADroppedConnectionEndsWithoutAWordToTheClient(t *testing.T) {
	fake := &recorder{}
	fake.nextOps, fake.nextErrors = ops("SELECT", "SELECT")
	fake.execResults, fake.execErrors = results(2)

	serve(t, fake, []control.Rule{{Match: "fake.SELECT", Action: control.ActionDropConn}})
	seen := fake.seen()

	if len(seen.replies) != 0 || len(seen.failures) != 0 {
		t.Errorf("replies %#v failures %#v, want a dead socket instead", seen.replies, seen.failures)
	}
	if len(seen.ops) != 0 {
		t.Errorf("backend saw %#v, want nothing", seen.ops)
	}
}

func TestADelayIsServedBeforeTheOperation(t *testing.T) {
	fake := &recorder{}
	fake.nextOps, fake.nextErrors = ops("SELECT")
	fake.execResults, fake.execErrors = results(1)

	start := time.Now()
	serve(t, fake, []control.Rule{{Match: "fake.SELECT", Action: control.ActionDelay, Millis: 30}})
	seen := fake.seen()

	if elapsed := time.Since(start); elapsed < 30*time.Millisecond {
		t.Errorf("took %v, want at least the delay the rule asked for", elapsed)
	}
	if len(seen.replies) != 1 {
		t.Errorf("replies = %#v, want the operation still carried out", seen.replies)
	}
}

func TestAClientThatCannotBeWrittenToEndsTheConnection(t *testing.T) {
	for name, fake := range map[string]*recorder{
		"a reply that cannot be sent": {replyErr: errors.New("broken pipe")},
		"an error that cannot be sent": {
			failErr:     errors.New("broken pipe"),
			execErrors:  []error{errors.New("no such table"), nil},
			execResults: []Result{{}, {}},
		},
	} {
		t.Run(name, func(t *testing.T) {
			fake.nextOps, fake.nextErrors = ops("SELECT", "SELECT")
			if fake.execResults == nil {
				fake.execResults, fake.execErrors = results(2)
			}

			serve(t, fake, nil)
			seen := fake.seen()

			if len(seen.ops) != 1 {
				t.Errorf("backend saw %d operations, want the loop to stop after the first", len(seen.ops))
			}
		})
	}
}

func TestAConnectionThatCannotBeSetUpIsDroppedQuietly(t *testing.T) {
	for name, fake := range map[string]*recorder{
		"the backend has no connection to give": {openErr: errors.New("too many connections")},
		"the handshake failed":                  {acceptErr: errors.New("not a client")},
	} {
		t.Run(name, func(t *testing.T) {
			log := serve(t, fake, nil)

			if entries := log.Entries(); len(entries) != 0 {
				t.Errorf("op log = %#v, want nothing recorded for a connection that never happened", entries)
			}
		})
	}
}

func TestServeStopsWhenTheListenerCloses(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listening: %v", err)
	}
	intercept, err := control.New(nil, oplog.New(0))
	if err != nil {
		t.Fatalf("arming rules: %v", err)
	}

	stopped := make(chan struct{})
	emulator := &Emulator{Proto: &recorder{}, Backend: &recorder{}}
	go func() {
		emulator.Serve(listener, intercept)
		close(stopped)
	}()

	_ = listener.Close()
	select {
	case <-stopped:
	case <-time.After(time.Second):
		t.Fatal("Serve did not return after its listener closed")
	}
}
