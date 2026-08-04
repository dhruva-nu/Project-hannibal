package main

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// emuBinary builds the real command once per test run, so these tests exercise
// the same entry point the container does rather than calling into the packages
// directly.
func emuBinary(t *testing.T) string {
	t.Helper()
	binary := filepath.Join(t.TempDir(), "emu")
	build := exec.Command("go", "build", "-o", binary, ".")
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("go build: %v\n%s", err, output)
	}
	return binary
}

func TestBinaryPassesThroughChildOutputAndExitCode(t *testing.T) {
	var stdout, stderr bytes.Buffer

	run := exec.Command(emuBinary(t), "run", "--", "sh", "-c", "echo out; echo err >&2; exit 5")
	run.Stdout = &stdout
	run.Stderr = &stderr
	err := run.Run()

	var exit *exec.ExitError
	if !errorAs(err, &exit) {
		t.Fatalf("err = %v, want an ExitError carrying the child's code", err)
	}
	if exit.ExitCode() != 5 {
		t.Errorf("exit code = %d, want 5", exit.ExitCode())
	}
	if got := strings.TrimSpace(stdout.String()); got != "out" {
		t.Errorf("stdout = %q, want %q", got, "out")
	}
	if got := strings.TrimSpace(stderr.String()); got != "err" {
		t.Errorf("stderr = %q, want %q", got, "err")
	}
}

func TestBinaryReportsUsageErrors(t *testing.T) {
	run := exec.Command(emuBinary(t), "run")
	output, err := run.CombinedOutput()

	var exit *exec.ExitError
	if !errorAs(err, &exit) {
		t.Fatalf("err = %v, want a non-zero exit", err)
	}
	if exit.ExitCode() != 2 {
		t.Errorf("exit code = %d, want 2", exit.ExitCode())
	}
	if !strings.Contains(string(output), "emu: ") {
		t.Errorf("output = %q, want an emu-prefixed diagnostic", output)
	}
}

func TestBinaryLeavesNoZombiesBehind(t *testing.T) {
	// The child orphans a grandchild and exits immediately. emu is that
	// grandchild's new parent, and must collect it rather than exiting with a
	// zombie still holding a process slot.
	run := exec.Command(emuBinary(t), "run", "--",
		"sh", "-c", `sh -c 'sleep 0.2; exit 0' & exit 0`)
	if err := run.Run(); err != nil {
		t.Fatalf("run: %v", err)
	}
	if run.ProcessState.ExitCode() != 0 {
		t.Errorf("exit code = %d, want 0", run.ProcessState.ExitCode())
	}
}

func TestMain(m *testing.M) {
	os.Exit(m.Run())
}

func errorAs(err error, target **exec.ExitError) bool {
	exit, ok := err.(*exec.ExitError)
	if ok {
		*target = exit
	}
	return ok
}
