package cli

import (
	"bytes"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestSplitCommandSeparatesEmuArgumentsFromTheChild(t *testing.T) {
	own, argv, err := SplitCommand([]string{"--config", "c.json", "--", "python3", "-u", "/tmp/app.py"})
	if err != nil {
		t.Fatalf("SplitCommand: %v", err)
	}
	if want := []string{"--config", "c.json"}; !equal(own, want) {
		t.Errorf("own = %v, want %v", own, want)
	}
	if want := []string{"python3", "-u", "/tmp/app.py"}; !equal(argv, want) {
		t.Errorf("argv = %v, want %v", argv, want)
	}
}

func TestSplitCommandKeepsChildSeparators(t *testing.T) {
	// Only the first separator belongs to emu; the rest are the child's.
	_, argv, err := SplitCommand([]string{"--", "sh", "-c", "cmd -- flag"})
	if err != nil {
		t.Fatalf("SplitCommand: %v", err)
	}
	if want := []string{"sh", "-c", "cmd -- flag"}; !equal(argv, want) {
		t.Errorf("argv = %v, want %v", argv, want)
	}
}

func TestSplitCommandRejectsMissingSeparator(t *testing.T) {
	if _, _, err := SplitCommand([]string{"python3", "app.py"}); err == nil {
		t.Error("err = nil, want a missing-separator failure")
	}
}

func TestSplitCommandRejectsEmptyCommand(t *testing.T) {
	if _, _, err := SplitCommand([]string{"--"}); err == nil {
		t.Error("err = nil, want an empty-command failure")
	}
}

func TestRunPropagatesChildExitCode(t *testing.T) {
	var stdout, stderr bytes.Buffer
	if code := Run([]string{"run", "--", "sh", "-c", "exit 9"}, &stdout, &stderr); code != 9 {
		t.Errorf("exit code = %d, want 9", code)
	}
	if stderr.Len() != 0 {
		t.Errorf("stderr = %q, want empty for a successful launch", stderr.String())
	}
}

func TestRunReportsMissingCommandAsShellDoes(t *testing.T) {
	var stdout, stderr bytes.Buffer
	code := Run([]string{"run", "--", "emu-no-such-command-exists"}, &stdout, &stderr)
	if code != exitNotFound {
		t.Errorf("exit code = %d, want %d", code, exitNotFound)
	}
	if !strings.HasPrefix(stderr.String(), "emu: ") {
		t.Errorf("stderr = %q, want an emu-prefixed diagnostic", stderr.String())
	}
}

func TestRunRejectsUsageErrors(t *testing.T) {
	for name, args := range map[string][]string{
		"no arguments":          {},
		"unknown command":       {"serve"},
		"missing command":       {"run"},
		"empty after --":        {"run", "--"},
		"unknown run flag":      {"run", "--faults", "x", "--", "true"},
		"a flag with no value":  {"run", "--config", "--", "true"},
		"a stray argument":      {"run", "leftover", "--", "true"},
		"no ctl command":        {"ctl"},
		"unknown ctl command":   {"ctl", "restart"},
		"ctl without a socket":  {"ctl", "oplog"},
		"a stray ctl argument":  {"ctl", "oplog", "--socket", "s", "leftover"},
		"unknown ctl flag":      {"ctl", "oplog", "--socket", "s", "--force"},
		"rule flags on a query": {"ctl", "fault", "list", "--socket", "s", "--match", "redis.*"},
		"an unfireable rule":    {"ctl", "fault", "add", "--socket", "s", "--action", "delay"},
		"a malformed condition": {"ctl", "fault", "add", "--socket", "s", "--when", "depth_gte"},
	} {
		t.Run(name, func(t *testing.T) {
			var stdout, stderr bytes.Buffer
			if code := Run(args, &stdout, &stderr); code != exitUsage {
				t.Errorf("exit code = %d, want %d", code, exitUsage)
			}
			if !strings.Contains(stderr.String(), "emu: ") {
				t.Errorf("stderr = %q, want a diagnostic", stderr.String())
			}
		})
	}
}

func TestRunPrintsUsageOnRequest(t *testing.T) {
	for _, arg := range []string{"help", "-h", "--help"} {
		var stdout, stderr bytes.Buffer
		if code := Run([]string{arg}, &stdout, &stderr); code != 0 {
			t.Errorf("%s: exit code = %d, want 0", arg, code)
		}
		if !strings.Contains(stderr.String(), "emu run [flags] -- <command>") {
			t.Errorf("%s: stderr = %q, want usage", arg, stderr.String())
		}
	}
}

func TestUsageWarnsThatTheControlSocketIsDevOnly(t *testing.T) {
	// The one flag a lesson run must never carry, so the warning belongs where
	// anyone wiring emu up will read it.
	if !strings.Contains(usage, devControlSocketFlag) || !strings.Contains(usage, "DEV ONLY") {
		t.Error("usage does not warn that the control socket is dev-only")
	}
}

func TestStartFailureCodeMatchesShellConventions(t *testing.T) {
	for name, testCase := range map[string]struct {
		err  error
		want int
	}{
		"missing command":   {exec.ErrNotFound, exitNotFound},
		"not executable":    {fs.ErrPermission, exitNotExecutable},
		"anything else":     {errors.New("some other failure"), 1},
		"wrapped not found": {fmt.Errorf("locating %q: %w", "x", exec.ErrNotFound), exitNotFound},
	} {
		t.Run(name, func(t *testing.T) {
			if got := startFailureCode(testCase.err); got != testCase.want {
				t.Errorf("startFailureCode = %d, want %d", got, testCase.want)
			}
		})
	}
}

func TestRunReportsUnexecutableCommandAsShellDoes(t *testing.T) {
	unexecutable := filepath.Join(t.TempDir(), "not-executable")
	if err := os.WriteFile(unexecutable, []byte("#!/bin/sh\n"), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	var stdout, stderr bytes.Buffer
	if code := Run([]string{"run", "--", unexecutable}, &stdout, &stderr); code != exitNotExecutable {
		t.Errorf("exit code = %d, want %d", code, exitNotExecutable)
	}
}

func equal(got, want []string) bool {
	if len(got) != len(want) {
		return false
	}
	for i := range got {
		if got[i] != want[i] {
			return false
		}
	}
	return true
}

// failingWriter stands in for a stdout that has gone away, so the diagnostics for
// a lost op log are exercised rather than assumed.
type failingWriter struct{}

func (failingWriter) Write([]byte) (int, error) { return 0, errors.New("stdout is gone") }
