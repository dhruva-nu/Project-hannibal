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

func TestSplitCommandReturnsArgvAfterSeparator(t *testing.T) {
	argv, err := SplitCommand([]string{"--", "python3", "-u", "/tmp/app.py"})
	if err != nil {
		t.Fatalf("SplitCommand: %v", err)
	}
	if want := []string{"python3", "-u", "/tmp/app.py"}; !equal(argv, want) {
		t.Errorf("argv = %v, want %v", argv, want)
	}
}

func TestSplitCommandKeepsChildSeparators(t *testing.T) {
	// Only the first separator belongs to emu; the rest are the child's.
	argv, err := SplitCommand([]string{"--", "sh", "-c", "cmd -- flag"})
	if err != nil {
		t.Fatalf("SplitCommand: %v", err)
	}
	if want := []string{"sh", "-c", "cmd -- flag"}; !equal(argv, want) {
		t.Errorf("argv = %v, want %v", argv, want)
	}
}

func TestSplitCommandRejectsMissingSeparator(t *testing.T) {
	if _, err := SplitCommand([]string{"python3", "app.py"}); err == nil {
		t.Error("err = nil, want a missing-separator failure")
	}
}

func TestSplitCommandRejectsEmptyCommand(t *testing.T) {
	if _, err := SplitCommand([]string{"--"}); err == nil {
		t.Error("err = nil, want an empty-command failure")
	}
}

func TestSplitCommandRejectsUnknownArgumentsBeforeSeparator(t *testing.T) {
	// P1 adds --config here; until then an unrecognised flag must not be silently
	// swallowed.
	_, err := SplitCommand([]string{"--config", "x.json", "--", "python3"})
	if err == nil {
		t.Fatal("err = nil, want an unexpected-argument failure")
	}
	if !strings.Contains(err.Error(), "--config") {
		t.Errorf("err = %v, want it to name the offending argument", err)
	}
}

func TestRunPropagatesChildExitCode(t *testing.T) {
	var stderr bytes.Buffer
	if code := Run([]string{"run", "--", "sh", "-c", "exit 9"}, &stderr); code != 9 {
		t.Errorf("exit code = %d, want 9", code)
	}
	if stderr.Len() != 0 {
		t.Errorf("stderr = %q, want empty for a successful launch", stderr.String())
	}
}

func TestRunReportsMissingCommandAsShellDoes(t *testing.T) {
	var stderr bytes.Buffer
	code := Run([]string{"run", "--", "emu-no-such-command-exists"}, &stderr)
	if code != exitNotFound {
		t.Errorf("exit code = %d, want %d", code, exitNotFound)
	}
	if !strings.HasPrefix(stderr.String(), "emu: ") {
		t.Errorf("stderr = %q, want an emu-prefixed diagnostic", stderr.String())
	}
}

func TestRunRejectsUsageErrors(t *testing.T) {
	for name, args := range map[string][]string{
		"no arguments":    {},
		"unknown command": {"serve"},
		"missing command": {"run"},
		"empty after --":  {"run", "--"},
	} {
		t.Run(name, func(t *testing.T) {
			var stderr bytes.Buffer
			if code := Run(args, &stderr); code != exitUsage {
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
		var stderr bytes.Buffer
		if code := Run([]string{arg}, &stderr); code != 0 {
			t.Errorf("%s: exit code = %d, want 0", arg, code)
		}
		if !strings.Contains(stderr.String(), "emu run -- <command>") {
			t.Errorf("%s: stderr = %q, want usage", arg, stderr.String())
		}
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

	var stderr bytes.Buffer
	if code := Run([]string{"run", "--", unexecutable}, &stderr); code != exitNotExecutable {
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
