package control

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestTheDashboardAddsAFaultToARunningEmu(t *testing.T) {
	// The P2 exit criterion: with only P1 built, the page can arm a rule against a
	// locally-running emu and see the op log react.
	interceptor := mustArm(t)
	url := host(t, interceptor, nil)

	ask(t, "POST", url+"/api/faults", `{"match":"redis.SET","action":"error","message":"disk full"}`, http.StatusOK)

	var armed struct{ Rules []Rule }
	get(t, url+"/api/state?since=0", &armed)
	if len(armed.Rules) != 1 || armed.Rules[0].Match != "redis.SET" {
		t.Fatalf("rules = %+v, want the armed rule", armed.Rules)
	}

	var verdict verdictView
	askInto(t, "POST", url+"/api/ops", `{"emulator":"redis","kind":"SET"}`, &verdict)
	if verdict.Error != "disk full" {
		t.Errorf("verdict = %+v, want the armed fault to fire", verdict)
	}

	var after state
	get(t, url+"/api/state?since=0", &after)
	if len(after.Entries) == 0 {
		t.Fatal("the op log is empty after firing an operation")
	}
	last := after.Entries[len(after.Entries)-1]
	if last.Fault != "error" || last.Control != "synthetic" {
		t.Errorf("entry = %+v, want a faulted synthetic operation", last)
	}
}

func TestStateOnlyReturnsWhatThePollerHasNotSeen(t *testing.T) {
	interceptor := mustArm(t)
	interceptor.Before(Op{Emulator: "redis", Kind: "GET"})
	interceptor.Before(Op{Emulator: "redis", Kind: "SET"})
	url := host(t, interceptor, nil)

	var fresh state
	get(t, url+"/api/state?since=1", &fresh)

	if len(fresh.Entries) != 1 || fresh.Entries[0].Op != "SET" {
		t.Errorf("entries = %+v, want only what follows ordinal 1", fresh.Entries)
	}
}

func TestAnUnreadableCursorStartsFromTheBeginning(t *testing.T) {
	interceptor := mustArm(t)
	interceptor.Before(Op{Emulator: "redis", Kind: "GET"})
	url := host(t, interceptor, nil)

	var fromScratch state
	get(t, url+"/api/state?since=nonsense", &fromScratch)

	if len(fromScratch.Entries) != 1 {
		t.Errorf("entries = %+v, want the whole log when the cursor is unreadable", fromScratch.Entries)
	}
}

func TestTheDashboardRemovesAndResetsRules(t *testing.T) {
	interceptor := mustArm(t,
		Rule{Match: "redis.*", Action: ActionDelay, Millis: 1},
		Rule{Match: "postgres.COMMIT", Action: ActionError},
	)
	url := host(t, interceptor, nil)

	var left struct{ Rules []Rule }
	askInto(t, "DELETE", url+"/api/faults/0", "", &left)
	if len(left.Rules) != 1 || left.Rules[0].Match != "postgres.COMMIT" {
		t.Errorf("rules = %+v, want only the commit rule left", left.Rules)
	}

	ask(t, "POST", url+"/api/faults/reset", "", http.StatusOK)
	if got := interceptor.Rules(); len(got) != 0 {
		t.Errorf("rules = %+v, want none after a reset", got)
	}
}

func TestTheControlPlaneRefusesWhatItCannotHonour(t *testing.T) {
	url := host(t, mustArm(t, Rule{Match: "redis.*", Action: ActionDropConn}), nil)

	for name, testCase := range map[string]struct {
		method, path, body string
		status             int
		names              string
	}{
		"a rule that is not JSON":    {"POST", "/api/faults", `{`, http.StatusBadRequest, "unexpected EOF"},
		"a rule with a stray knob":   {"POST", "/api/faults", `{"match":"redis.*","action":"error","socket":"/tmp/x"}`, http.StatusBadRequest, "socket"},
		"a rule that cannot fire":    {"POST", "/api/faults", `{"match":"redis.*","action":"delay"}`, http.StatusBadRequest, "ms"},
		"an index that is a word":    {"DELETE", "/api/faults/second", "", http.StatusBadRequest, "second"},
		"an index that is not there": {"DELETE", "/api/faults/9", "", http.StatusNotFound, "no rule"},
		"an op that is not JSON":     {"POST", "/api/ops", `nope`, http.StatusBadRequest, "invalid"},
		"an op with no kind":         {"POST", "/api/ops", `{"emulator":"redis"}`, http.StatusBadRequest, "kind"},
	} {
		t.Run(name, func(t *testing.T) {
			body := ask(t, testCase.method, url+testCase.path, testCase.body, testCase.status)
			if !strings.Contains(body, testCase.names) {
				t.Errorf("refusal = %s, want it to name %q", body, testCase.names)
			}
		})
	}
}

func TestTheDashboardRunsAndStopsAChild(t *testing.T) {
	url := host(t, mustArm(t), NewRunner())

	var started ChildStatus
	askInto(t, "POST", url+"/api/child", `{"command":"echo hello"}`, &started)
	if started.Command != "echo hello" {
		t.Errorf("status = %+v, want the command echoed back", started)
	}

	var finished state
	waitUntil(t, func() bool {
		get(t, url+"/api/state?since=0&output=0", &finished)
		return finished.Child != nil && finished.Child.Exited
	})
	if finished.Child.ExitCode != 0 {
		t.Errorf("exit code = %d, want 0", finished.Child.ExitCode)
	}
	if !strings.Contains(transcript(*finished.Child), "hello") {
		t.Errorf("output = %q, want the child's stdout", transcript(*finished.Child))
	}
}

func TestTheDashboardStopsAChildThatWillNotFinish(t *testing.T) {
	url := host(t, mustArm(t), NewRunner())
	ask(t, "POST", url+"/api/child", `{"command":"echo up; sleep 30"}`, http.StatusOK)

	var running state
	waitUntil(t, func() bool {
		get(t, url+"/api/state?since=0&output=0", &running)
		return running.Child != nil && strings.Contains(transcript(*running.Child), "up\n")
	})

	var stopped ChildStatus
	askInto(t, "DELETE", url+"/api/child", "", &stopped)

	var finished state
	waitUntil(t, func() bool {
		get(t, url+"/api/state?since=0&output=0", &finished)
		return finished.Child.Exited
	})
	if finished.Child.ExitCode == 0 {
		t.Error("exit code = 0, want the signal reported")
	}
}

func TestChildOutputIsPolledIncrementally(t *testing.T) {
	url := host(t, mustArm(t), NewRunner())
	ask(t, "POST", url+"/api/child", `{"command":"echo hello"}`, http.StatusOK)

	var whole state
	waitUntil(t, func() bool {
		get(t, url+"/api/state?since=0&output=0", &whole)
		return whole.Child != nil && whole.Child.Exited
	})

	last := whole.Child.Output[len(whole.Child.Output)-1].N
	var caughtUp state
	get(t, url+"/api/state?output="+strconv.Itoa(last), &caughtUp)
	if len(caughtUp.Child.Output) != 0 {
		t.Errorf("output = %+v, want nothing new", caughtUp.Child.Output)
	}
}

func TestAnEmuThatAlreadySupervisesWillNotStartASecondChild(t *testing.T) {
	// Two supervisors in one process both reap with wait(-1), so each would
	// collect the other's exit status.
	dashboard := serveOn(t, mustArm(t), nil, About{Child: "python3 app.py"})

	body := ask(t, "POST", dashboard.URL()+"/api/child", `{"command":"echo hi"}`, http.StatusConflict)

	if !strings.Contains(body, "python3 app.py") {
		t.Errorf("refusal = %s, want it to name what is already supervised", body)
	}
	if stop := ask(t, "DELETE", dashboard.URL()+"/api/child", "", http.StatusConflict); !strings.Contains(stop, "python3") {
		t.Errorf("refusal = %s, want the stop refused too", stop)
	}

	var reported state
	get(t, dashboard.URL()+"/api/state", &reported)
	if reported.Child != nil {
		t.Errorf("child = %+v, want the panel hidden entirely", reported.Child)
	}
	if reported.About.CanRun {
		t.Error("can_run = true, want the page told it may not start a child")
	}
}

func TestTheChildRoutesRefuseWhatTheRunnerRefuses(t *testing.T) {
	url := host(t, mustArm(t), NewRunner())

	for name, testCase := range map[string]struct {
		method, body string
		status       int
		names        string
	}{
		"a body that is not JSON": {"POST", `{`, http.StatusBadRequest, "unexpected EOF"},
		"an empty command":        {"POST", `{"command":"  "}`, http.StatusConflict, "no command"},
		"a stop with no child":    {"DELETE", "", http.StatusConflict, "nothing is running"},
		"a second stop":           {"DELETE", "", http.StatusConflict, "nothing is running"},
	} {
		t.Run(name, func(t *testing.T) {
			body := ask(t, testCase.method, url+"/api/child", testCase.body, testCase.status)
			if !strings.Contains(body, testCase.names) {
				t.Errorf("refusal = %s, want it to name %q", body, testCase.names)
			}
		})
	}
}

func TestThePageIsServedFromTheBinary(t *testing.T) {
	url := host(t, mustArm(t), nil)

	response, err := http.Get(url + "/")
	if err != nil {
		t.Fatalf("GET /: %v", err)
	}
	defer func() { _ = response.Body.Close() }()
	page, _ := io.ReadAll(response.Body)

	if got := response.Header.Get("Content-Type"); !strings.HasPrefix(got, "text/html") {
		t.Errorf("content type = %q, want html", got)
	}
	if !strings.Contains(string(page), "emu control") {
		t.Error("the served page is not the dashboard")
	}
	if strings.Contains(string(page), "://") && !strings.Contains(string(page), "http-equiv") {
		t.Error("the page reaches outside the binary; it must be self-contained")
	}
}

func TestBindRefusesAnAddressThatLeavesTheMachine(t *testing.T) {
	// The plan wrote ":9100", which binds every interface. On a shared network
	// that hands anyone a fault injector and a live op log.
	for _, address := range []string{":9100", "0.0.0.0:9100", "192.168.1.4:9100", "9100", "127.0.0.1", "127.0.0.1:"} {
		if _, err := Bind(address, mustArm(t), About{}, nil); err == nil {
			t.Errorf("Bind(%q) = nil, want it refused", address)
		}
	}
}

func TestBindAcceptsLoopback(t *testing.T) {
	for _, address := range []string{"127.0.0.1:0", "localhost:0", "[::1]:0"} {
		dashboard, err := Bind(address, mustArm(t), About{}, nil)
		if err != nil {
			t.Errorf("Bind(%q): %v", address, err)
			continue
		}
		if !strings.HasPrefix(dashboard.URL(), "http://") {
			t.Errorf("URL = %q, want something a browser can open", dashboard.URL())
		}
		_ = dashboard.Close()
	}
}

func TestBindReportsAPortItCannotTake(t *testing.T) {
	taken := serveOn(t, mustArm(t), nil, About{})

	if _, err := Bind(taken.listener.Addr().String(), mustArm(t), About{}, nil); err == nil {
		t.Error("Bind = nil, want a second dashboard on the same port refused")
	}
}

// ── helpers ───────────────────────────────────────────────────────────────

func host(t *testing.T, interceptor *Interceptor, runner *Runner) string {
	t.Helper()
	return serveOn(t, interceptor, runner, About{Services: []string{"redis"}}).URL()
}

func serveOn(t *testing.T, interceptor *Interceptor, runner *Runner, about About) *Dashboard {
	t.Helper()
	dashboard, err := Bind("127.0.0.1:0", interceptor, about, runner)
	if err != nil {
		t.Fatalf("Bind: %v", err)
	}
	t.Cleanup(func() { _ = dashboard.Close() })
	go dashboard.Serve()
	return dashboard
}

func ask(t *testing.T, method, url, body string, want int) string {
	t.Helper()
	request, err := http.NewRequest(method, url, bytes.NewBufferString(body))
	if err != nil {
		t.Fatalf("%s %s: %v", method, url, err)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("%s %s: %v", method, url, err)
	}
	defer func() { _ = response.Body.Close() }()

	answer, _ := io.ReadAll(response.Body)
	if response.StatusCode != want {
		t.Fatalf("%s %s = %d, want %d: %s", method, url, response.StatusCode, want, answer)
	}
	return string(answer)
}

func askInto(t *testing.T, method, url, body string, into any) {
	t.Helper()
	if err := json.Unmarshal([]byte(ask(t, method, url, body, http.StatusOK)), into); err != nil {
		t.Fatalf("%s %s returned unreadable JSON: %v", method, url, err)
	}
}

func get(t *testing.T, url string, into any) {
	t.Helper()
	askInto(t, "GET", url, "", into)
}

func waitUntil(t *testing.T, done func() bool) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if done() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("timed out waiting for the child")
}

func transcript(status ChildStatus) string {
	var whole strings.Builder
	for _, chunk := range status.Output {
		whole.WriteString(chunk.Text)
	}
	return whole.String()
}
