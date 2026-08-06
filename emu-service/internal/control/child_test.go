package control

import (
	"errors"
	"os"
	"strings"
	"testing"
	"time"
)

func TestStartCapturesBothStreamsAndTheExitCode(t *testing.T) {
	runner := NewRunner()

	if err := runner.Start(`echo out; echo err >&2; exit 7`); err != nil {
		t.Fatalf("Start: %v", err)
	}

	status := settled(t, runner)
	if status.ExitCode != 7 {
		t.Errorf("exit code = %d, want 7", status.ExitCode)
	}
	if !hasChunk(status, "stdout", "out") {
		t.Errorf("output = %s, want the child's stdout", flatten(status))
	}
	if !hasChunk(status, "stderr", "err") {
		t.Errorf("output = %s, want the child's stderr kept apart", flatten(status))
	}
}

func TestTheSessionReadsLikeATerminal(t *testing.T) {
	// The command that was run and the code it exited with are part of the
	// transcript, so a run that produced no output is still legible.
	runner := NewRunner()
	if err := runner.Start("true"); err != nil {
		t.Fatalf("Start: %v", err)
	}

	transcript := flatten(settled(t, runner))
	if !strings.Contains(transcript, "$ true") {
		t.Errorf("transcript = %q, want the command echoed", transcript)
	}
	if !strings.Contains(transcript, "exited 0") {
		t.Errorf("transcript = %q, want the exit code", transcript)
	}
}

func TestASecondRunAppendsRatherThanErasing(t *testing.T) {
	runner := NewRunner()
	if err := runner.Start("echo first"); err != nil {
		t.Fatalf("Start: %v", err)
	}
	settled(t, runner)
	if err := runner.Start("echo second"); err != nil {
		t.Fatalf("Start: %v", err)
	}

	transcript := flatten(settled(t, runner))
	if !strings.Contains(transcript, "first") || !strings.Contains(transcript, "second") {
		t.Errorf("transcript = %q, want both runs", transcript)
	}
}

func TestStatusReturnsOnlyWhatThePageHasNotSeen(t *testing.T) {
	runner := NewRunner()
	if err := runner.Start("echo hello"); err != nil {
		t.Fatalf("Start: %v", err)
	}
	full := settled(t, runner)

	last := full.Output[len(full.Output)-1].N
	if fresh := runner.Status(last); len(fresh.Output) != 0 {
		t.Errorf("Status(%d) = %+v, want nothing new", last, fresh.Output)
	}
}

func TestOnlyOneChildRunsAtATime(t *testing.T) {
	runner := NewRunner()
	if err := runner.Start("echo up; sleep 5"); err != nil {
		t.Fatalf("Start: %v", err)
	}
	t.Cleanup(func() { _ = runner.Stop() })
	waitForOutput(t, runner, "up")

	err := runner.Start("echo second")

	if err == nil {
		t.Fatal("Start = nil, want the second command refused")
	}
	if !strings.Contains(err.Error(), "sleep 5") {
		t.Errorf("Start = %v, want it to name what is running", err)
	}
}

func TestStopEndsARunningChild(t *testing.T) {
	runner := NewRunner()
	if err := runner.Start("echo up; sleep 30"); err != nil {
		t.Fatalf("Start: %v", err)
	}
	waitForOutput(t, runner, "up")

	if err := runner.Stop(); err != nil {
		t.Fatalf("Stop: %v", err)
	}

	status := settled(t, runner)
	if status.ExitCode == 0 {
		t.Errorf("exit code = 0, want the signal reported")
	}
}

func TestStopReportsThatNothingIsRunning(t *testing.T) {
	if err := NewRunner().Stop(); err == nil {
		t.Error("Stop = nil, want it to say nothing is running")
	}
}

func TestStopDistinguishesAChildThatHasNotForkedYet(t *testing.T) {
	// claim marks the runner busy before the process exists, so a stop in that
	// window must not report the child as absent.
	runner := NewRunner()
	if err := runner.claim("sleep 5"); err != nil {
		t.Fatalf("claim: %v", err)
	}

	err := runner.Stop()

	if err == nil || !strings.Contains(err.Error(), "still starting") {
		t.Errorf("Stop = %v, want it to say the child is still starting", err)
	}
}

func TestStartRefusesAnEmptyCommand(t *testing.T) {
	for _, command := range []string{"", "   "} {
		if err := NewRunner().Start(command); err == nil {
			t.Errorf("Start(%q) = nil, want a refusal", command)
		}
	}
}

func TestStartReportsAChildThatCannotBeLaunched(t *testing.T) {
	runner := NewRunner()

	// sh exists everywhere, so the way to fail a launch is to run out of pipes.
	for _, failAt := range []int{1, 2} {
		if err := runner.start("true", failingPipe(failAt)); err == nil {
			t.Errorf("start with pipe %d failing = nil, want the failure reported", failAt)
		}
		status := runner.Status(0)
		if status.Running {
			t.Error("a child that never launched is still marked running")
		}
		if status.ExitCode != exitUnstarted {
			t.Errorf("exit code = %d, want %d", status.ExitCode, exitUnstarted)
		}
	}
}

func TestStartReportsAShellThatIsNotThere(t *testing.T) {
	runner := NewRunner()
	runner.shell = "emu-no-such-shell"

	if err := runner.Start("true"); err != nil {
		t.Fatalf("Start: %v", err)
	}

	status := settled(t, runner)
	if status.ExitCode != exitUnstarted {
		t.Errorf("exit code = %d, want %d", status.ExitCode, exitUnstarted)
	}
	if !strings.Contains(flatten(status), "emu-no-such-shell") {
		t.Errorf("transcript = %q, want it to name what could not be launched", flatten(status))
	}
}

func TestOutputBeyondTheLimitIsDroppedAndCounted(t *testing.T) {
	runner := NewRunner()

	// Two chunks over the limit, so the first is evicted rather than the buffer
	// growing without bound.
	runner.append("stdout", strings.Repeat("x", outputLimit))
	runner.append("stdout", strings.Repeat("y", outputLimit))

	status := runner.Status(0)
	if status.Dropped == 0 {
		t.Error("dropped = 0, want the eviction counted")
	}
	if strings.Contains(flatten(status), "x") {
		t.Error("the oldest chunk survived, so the buffer is unbounded")
	}
}

func TestAnUnstartedRunnerReportsNothing(t *testing.T) {
	status := NewRunner().Status(0)

	if status.Running || status.Exited || status.Command != "" {
		t.Errorf("status = %+v, want an idle runner", status)
	}
}

// settled waits for the child to exit and returns everything it produced.
func settled(t *testing.T, runner *Runner) ChildStatus {
	t.Helper()
	waitFor(t, func() bool {
		status := runner.Status(0)
		return status.Exited && !status.Running
	})
	return runner.Status(0)
}

// waitForOutput waits until the child itself has written something. Waiting on
// the whole transcript would match the echoed command line, which claim appends
// before the process exists.
func waitForOutput(t *testing.T, runner *Runner, text string) {
	t.Helper()
	waitFor(t, func() bool { return hasChunk(runner.Status(0), "stdout", text) })
}

func waitFor(t *testing.T, done func() bool) {
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

func hasChunk(status ChildStatus, stream, text string) bool {
	for _, chunk := range status.Output {
		if chunk.Stream == stream && strings.Contains(chunk.Text, text) {
			return true
		}
	}
	return false
}

func flatten(status ChildStatus) string {
	var transcript strings.Builder
	for _, chunk := range status.Output {
		transcript.WriteString(chunk.Text)
	}
	return transcript.String()
}

// failingPipe returns a pipe constructor that fails on the nth call, so both
// halves of capture's error handling are reachable.
func failingPipe(nth int) func() (*os.File, *os.File, error) {
	calls := 0
	return func() (*os.File, *os.File, error) {
		calls++
		if calls == nth {
			return nil, nil, errors.New("too many open files")
		}
		return os.Pipe()
	}
}
