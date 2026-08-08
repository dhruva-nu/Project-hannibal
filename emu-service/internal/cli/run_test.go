package cli

import (
	"bytes"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// postgresOnly is the smallest usable config, and the emulators it declares are
// sent to ephemeral ports by onEphemeralPorts — see cli_test.go.
const postgresOnly = `{"services":["postgres"]}`

func TestABareRunLeavesStdoutToTheChild(t *testing.T) {
	// Without a config there are no emulators and nothing to report, so emu must
	// still be exactly P0's supervisor: one command, one stream, nothing added.
	var stdout, stderr bytes.Buffer

	if code := Run([]string{"run", "--", "true"}, &stdout, &stderr); code != 0 {
		t.Fatalf("exit = %d, stderr = %s", code, stderr.String())
	}
	if stdout.Len() != 0 {
		t.Errorf("stdout = %q, want nothing added to the child's output", stdout.String())
	}
}

func TestAConfiguredRunDumpsItsOpLog(t *testing.T) {
	onEphemeralPorts(t)
	var stdout, stderr bytes.Buffer

	code := Run([]string{"run", "--config", writeConfig(t, postgresOnly), "--", "true"}, &stdout, &stderr)

	if code != 0 {
		t.Fatalf("exit = %d, stderr = %s", code, stderr.String())
	}
	if !strings.Contains(stdout.String(), `"emu_oplog":[]`) {
		t.Errorf("stdout = %q, want the tagged op log", stdout.String())
	}
}

func TestARunWithAnUnusableConfigFailsBeforeTheChildStarts(t *testing.T) {
	for name, testCase := range map[string]struct {
		args  []string
		names string
	}{
		"a missing file": {
			[]string{"run", "--config", filepath.Join(t.TempDir(), "absent.json"), "--", "true"},
			"reading the config",
		},
		"an unknown service": {
			[]string{"run", "--config", writeConfig(t, `{"services":["postgress"]}`), "--", "true"},
			"postgress",
		},
		"a fault that could never fire": {
			// config.Parse accepts the shape; arming it is where a delay with no
			// duration is caught, and that still happens before the child runs.
			[]string{"run", "--config", writeConfig(t, `{"services":["postgres"],"faults":[{"match":"postgres.*","action":"delay"}]}`), "--", "true"},
			"ms",
		},
	} {
		t.Run(name, func(t *testing.T) {
			var stdout, stderr bytes.Buffer
			if code := Run(testCase.args, &stdout, &stderr); code != exitConfig {
				t.Errorf("exit = %d, want %d", code, exitConfig)
			}
			if !strings.Contains(stderr.String(), testCase.names) {
				t.Errorf("stderr = %q, want it to name %q", stderr.String(), testCase.names)
			}
		})
	}
}

func TestARunThatCannotOpenItsControlSocketSaysSo(t *testing.T) {
	onEphemeralPorts(t)
	unusable := filepath.Join(t.TempDir(), "no-such-directory", "emu.sock")
	var stdout, stderr bytes.Buffer

	code := Run([]string{"run", "--" + devControlSocketFlag, unusable, "--", "true"}, &stdout, &stderr)

	if code != exitControl {
		t.Errorf("exit = %d, want %d", code, exitControl)
	}
	if !strings.Contains(stderr.String(), "dev control socket") {
		t.Errorf("stderr = %q, want it to name the socket", stderr.String())
	}
}

func TestALostOpLogIsReportedRatherThanDropped(t *testing.T) {
	onEphemeralPorts(t)
	var stderr bytes.Buffer

	code := Run([]string{"run", "--config", writeConfig(t, postgresOnly), "--", "true"}, failingWriter{}, &stderr)

	if code != exitControl {
		t.Errorf("exit = %d, want %d", code, exitControl)
	}
	if !strings.Contains(stderr.String(), "stdout is gone") {
		t.Errorf("stderr = %q, want the write failure reported", stderr.String())
	}
}

// TestOnlyArgvCanOpenTheControlSocket is the argv half of the phase's guarantee:
// config_test.go proves the loader has no such knob, and this proves the flag that
// does is emu's own, never derived from a lesson's input.
func TestOnlyArgvCanOpenTheControlSocket(t *testing.T) {
	fromArgv, _, err := parseRun([]string{"--" + devControlSocketFlag, "/tmp/emu.sock", "--", "true"})
	if err != nil {
		t.Fatalf("parseRun: %v", err)
	}
	if fromArgv.controlPath != "/tmp/emu.sock" {
		t.Errorf("controlPath = %q, want the argv flag honoured", fromArgv.controlPath)
	}

	fromConfig, _, err := parseRun([]string{"--config", "config.json", "--", "true"})
	if err != nil {
		t.Fatalf("parseRun: %v", err)
	}
	if fromConfig.controlPath != "" {
		t.Errorf("controlPath = %q, want nothing but the flag to set it", fromConfig.controlPath)
	}
}

func TestAConfigDrivenRunOpensNoSocketAtAll(t *testing.T) {
	onEphemeralPorts(t)
	directory := t.TempDir()
	everything := `{
	  "services": ["postgres"],
	  "seed": {"postgres": ["CREATE TABLE accounts (id INT)"]},
	  "faults": [{"match": "postgres.COMMIT", "action": "cap", "limit": 100}],
	  "log_limit": 32
	}`
	path := filepath.Join(directory, "config.json")
	if err := os.WriteFile(path, []byte(everything), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	var stdout, stderr bytes.Buffer
	if code := Run([]string{"run", "--config", path, "--", "true"}, &stdout, &stderr); code != 0 {
		t.Fatalf("exit = %d, stderr = %s", code, stderr.String())
	}

	entries, err := os.ReadDir(directory)
	if err != nil {
		t.Fatalf("ReadDir: %v", err)
	}
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			t.Fatalf("Info: %v", err)
		}
		if info.Mode().Type()&fs.ModeSocket != 0 {
			t.Errorf("%s is a socket: no config input may open a control channel", entry.Name())
		}
	}
}

// TestCtlAddsAFaultToAnAlreadyRunningEmu is P1's exit criterion, end to end: emu
// is supervising a child, ctl arms a rule over the dev socket, and the op log
// afterwards shows that the run was driven live.
func TestCtlAddsAFaultToAnAlreadyRunningEmu(t *testing.T) {
	onEphemeralPorts(t)
	directory := t.TempDir()
	socket := filepath.Join(directory, "emu.sock")
	release := filepath.Join(directory, "release")

	var supervised, superviseStderr bytes.Buffer
	finished := make(chan int, 1)
	go func() {
		finished <- Run([]string{
			"run", "--config", writeConfig(t, postgresOnly), "--" + devControlSocketFlag, socket, "--",
			"sh", "-c", "until [ -f " + release + " ]; do sleep 0.02; done",
		}, &supervised, &superviseStderr)
	}()
	waitForSocket(t, socket)

	var listed, ctlStderr bytes.Buffer
	code := Run([]string{
		"ctl", "fault", "add", "--socket", socket,
		"--match", "postgres.COMMIT", "--action", "error", "--message", "disk full",
	}, &listed, &ctlStderr)
	if code != 0 {
		t.Fatalf("emu ctl exit = %d, stderr = %s", code, ctlStderr.String())
	}
	if !strings.Contains(listed.String(), "postgres.COMMIT") {
		t.Errorf("ctl output = %s, want the armed rule echoed back", listed.String())
	}

	if err := os.WriteFile(release, nil, 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	if code := <-finished; code != 0 {
		t.Fatalf("emu run exit = %d, stderr = %s", code, superviseStderr.String())
	}
	if !strings.Contains(supervised.String(), `"control":"fault add postgres.COMMIT"`) {
		t.Errorf("op log = %s, want the live mutation recorded", supervised.String())
	}
}

func writeConfig(t *testing.T, document string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(path, []byte(document), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	return path
}

func waitForSocket(t *testing.T, path string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if _, err := os.Stat(path); err == nil {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("%s never appeared", path)
}
