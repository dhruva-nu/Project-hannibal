package cli

import (
	"bytes"
	"encoding/json"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"
)

func TestDevServesTheDashboardWithNoChild(t *testing.T) {
	onEphemeralPorts(t)
	var stdout, stderr bytes.Buffer

	code := serveDashboard(
		devOptions{bind: "127.0.0.1:0", configPath: writeConfig(t, postgresOnly)},
		&stdout, &stderr,
		func(url string) {
			state := poll(t, url)
			if state.About.CanRun != true {
				t.Error("can_run = false, want emu dev to allow starting a child")
			}
			if len(state.About.Services) != 1 || state.About.Services[0] != "postgres" {
				t.Errorf("services = %v, want the config's", state.About.Services)
			}
		},
	)

	if code != 0 {
		t.Fatalf("exit = %d, stderr = %s", code, stderr.String())
	}
	if !strings.Contains(stderr.String(), "dashboard on http://127.0.0.1:") {
		t.Errorf("stderr = %q, want the URL printed", stderr.String())
	}
	if !strings.Contains(stdout.String(), `"emu_oplog"`) {
		t.Errorf("stdout = %q, want the op log dumped on the way out", stdout.String())
	}
}

func TestDevArmsTheConfigsFaultsBeforeAnyoneConnects(t *testing.T) {
	onEphemeralPorts(t)
	config := writeConfig(t, `{"services":["postgres"],"faults":[{"match":"postgres.COMMIT","action":"error"}]}`)
	var stdout, stderr bytes.Buffer

	serveDashboard(devOptions{bind: "127.0.0.1:0", configPath: config}, &stdout, &stderr, func(url string) {
		if rules := poll(t, url).Rules; len(rules) != 1 {
			t.Errorf("rules = %v, want the config's fault already armed", rules)
		}
	})
}

func TestDevRefusesToLeaveTheMachine(t *testing.T) {
	var stdout, stderr bytes.Buffer

	code := serveDashboard(devOptions{bind: ":9100"}, &stdout, &stderr, func(string) {
		t.Error("the server started on a non-loopback address")
	})

	if code != exitControl {
		t.Errorf("exit = %d, want %d", code, exitControl)
	}
	if !strings.Contains(stderr.String(), "loopback") {
		t.Errorf("stderr = %q, want it to say why", stderr.String())
	}
}

func TestDevReportsAnUnusableConfig(t *testing.T) {
	for name, path := range map[string]string{
		"a missing file":                filepath.Join(t.TempDir(), "absent.json"),
		"a fault that could never fire": writeConfig(t, `{"services":["postgres"],"faults":[{"match":"postgres.*","action":"cap"}]}`),
	} {
		t.Run(name, func(t *testing.T) {
			var stdout, stderr bytes.Buffer
			code := serveDashboard(devOptions{bind: "127.0.0.1:0", configPath: path}, &stdout, &stderr, func(string) {
				t.Error("the dashboard started despite an unusable config")
			})
			if code != exitConfig {
				t.Errorf("exit = %d, want %d", code, exitConfig)
			}
		})
	}
}

func TestDevReportsAnOpLogItCannotWrite(t *testing.T) {
	onEphemeralPorts(t)
	var stderr bytes.Buffer

	code := serveDashboard(devOptions{bind: "127.0.0.1:0"}, failingWriter{}, &stderr, func(string) {})

	if code != exitControl {
		t.Errorf("exit = %d, want %d", code, exitControl)
	}
}

func TestRunDispatchesToTheDashboard(t *testing.T) {
	var stdout, stderr bytes.Buffer

	// A bind emu must refuse, so the dispatch is exercised without blocking on a
	// signal the way a real `emu dev` does.
	code := Run([]string{"dev", "--bind", "0.0.0.0:9100"}, &stdout, &stderr)

	if code != exitControl {
		t.Errorf("exit = %d, want %d", code, exitControl)
	}
	if !strings.Contains(stderr.String(), "loopback") {
		t.Errorf("stderr = %q, want the refusal", stderr.String())
	}
}

func TestRunReportsADevCommandLineItCannotRead(t *testing.T) {
	var stdout, stderr bytes.Buffer

	if code := Run([]string{"dev", "--port", "9100"}, &stdout, &stderr); code != exitUsage {
		t.Errorf("exit = %d, want %d", code, exitUsage)
	}
}

func TestWaitForInterruptReturnsWhenTheOperatorStops(t *testing.T) {
	// Registered here first so the signal can never reach the default handler and
	// kill the test binary before waitForInterrupt has its own registration up.
	guardrail := make(chan os.Signal, 1)
	signal.Notify(guardrail, syscall.SIGINT)
	defer signal.Stop(guardrail)

	returned := make(chan struct{})
	go func() {
		waitForInterrupt("")
		close(returned)
	}()

	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if err := syscall.Kill(os.Getpid(), syscall.SIGINT); err != nil {
			t.Fatalf("Kill: %v", err)
		}
		select {
		case <-returned:
			return
		case <-time.After(20 * time.Millisecond):
		}
	}
	t.Fatal("waitForInterrupt never returned")
}

func TestParseDevDefaultsToLoopback(t *testing.T) {
	options, err := parseDev(nil)
	if err != nil {
		t.Fatalf("parseDev: %v", err)
	}
	if options.bind != defaultBind || !strings.HasPrefix(options.bind, "127.0.0.1:") {
		t.Errorf("bind = %q, want a loopback default", options.bind)
	}
}

func TestParseDevRejectsWhatItCannotRead(t *testing.T) {
	for name, args := range map[string][]string{
		"an unknown flag":      {"--port", "9100"},
		"a stray argument":     {"leftover"},
		"a flag with no value": {"--bind"},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := parseDev(args); err == nil {
				t.Error("parseDev = nil, want a refusal")
			}
		})
	}
}

func TestRunServesTheDashboardBesideTheChild(t *testing.T) {
	onEphemeralPorts(t)
	// `emu run --dev-control-bind` watches a real supervised child; the page may
	// not start a second one.
	directory := t.TempDir()
	release := filepath.Join(directory, "release")
	var supervised bytes.Buffer
	runStderr := &reportedTo{}

	finished := make(chan int, 1)
	go func() {
		finished <- Run([]string{
			"run", "--config", writeConfig(t, postgresOnly), "--" + devControlBindFlag, "127.0.0.1:0", "--",
			"sh", "-c", "until [ -f " + release + " ]; do sleep 0.02; done",
		}, &supervised, runStderr)
	}()

	url := waitForURL(t, runStderr)
	state := poll(t, url)
	if state.About.CanRun {
		t.Error("can_run = true, want a supervising emu to refuse a second child")
	}
	if !strings.Contains(state.About.Child, "until [ -f") {
		t.Errorf("child = %q, want the supervised command", state.About.Child)
	}

	if err := os.WriteFile(release, nil, 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	if code := <-finished; code != 0 {
		t.Fatalf("exit = %d, stderr = %s", code, runStderr.String())
	}
}

func TestRunRefusesADashboardThatWouldLeaveTheMachine(t *testing.T) {
	var stdout, stderr bytes.Buffer

	code := Run([]string{"run", "--" + devControlBindFlag, "0.0.0.0:9100", "--", "true"}, &stdout, &stderr)

	if code != exitControl {
		t.Errorf("exit = %d, want %d", code, exitControl)
	}
	if !strings.Contains(stderr.String(), "loopback") {
		t.Errorf("stderr = %q, want it to say why", stderr.String())
	}
}

// ── helpers ───────────────────────────────────────────────────────────────

// dashboardState mirrors the fields these tests read from /api/state.
type dashboardState struct {
	About struct {
		Services   []string `json:"services"`
		ConfigPath string   `json:"config_path"`
		Child      string   `json:"child"`
		CanRun     bool     `json:"can_run"`
	} `json:"about"`
	Rules []map[string]any `json:"rules"`
}

func poll(t *testing.T, url string) dashboardState {
	t.Helper()
	response, err := http.Get(url + "/api/state")
	if err != nil {
		t.Fatalf("GET /api/state: %v", err)
	}
	defer func() { _ = response.Body.Close() }()

	var state dashboardState
	if err := json.NewDecoder(response.Body).Decode(&state); err != nil {
		t.Fatalf("decoding /api/state: %v", err)
	}
	return state
}

// waitForURL reads the address emu printed once it is bound.
func waitForURL(t *testing.T, stderr *reportedTo) string {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if _, after, found := strings.Cut(stderr.String(), "dashboard on "); found {
			return strings.TrimSpace(strings.SplitN(after, "\n", 2)[0])
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("emu never printed a dashboard URL: %s", stderr.String())
	return ""
}

// reportedTo is a stderr the test can read while emu is still writing to it.
type reportedTo struct {
	mutex   sync.Mutex
	written strings.Builder
}

func (r *reportedTo) Write(chunk []byte) (int, error) {
	r.mutex.Lock()
	defer r.mutex.Unlock()

	return r.written.Write(chunk)
}

func (r *reportedTo) String() string {
	r.mutex.Lock()
	defer r.mutex.Unlock()

	return r.written.String()
}

func TestDevReportsAnEmulatorItCannotStart(t *testing.T) {
	onEphemeralPorts(t)
	knowingAnUnbuiltService(t)
	var stdout, stderr bytes.Buffer

	code := serveDashboard(
		devOptions{bind: "127.0.0.1:0", configPath: writeConfig(t, `{"services":["`+unbuiltService+`"]}`)},
		&stdout, &stderr,
		func(string) { t.Error("the dashboard was served with no emulator behind it") },
	)

	if code != exitConfig {
		t.Errorf("exit = %d, want %d", code, exitConfig)
	}
	if !strings.Contains(stderr.String(), "no emulator yet") {
		t.Errorf("stderr = %q, want the service named", stderr.String())
	}
}
