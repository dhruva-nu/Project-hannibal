package supervise

import (
	"bufio"
	"errors"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

// capture runs argv with pipes in place of the standard streams and returns the
// exit code alongside what the child wrote.
func capture(t *testing.T, argv []string) (code int, stdout, stderr string) {
	t.Helper()

	outRead, outWrite := mustPipe(t)
	errRead, errWrite := mustPipe(t)

	collected := make(chan string, 2)
	go drain(outRead, collected)
	go drain(errRead, collected)

	code, err := Supervisor{Stdin: nil, Stdout: outWrite, Stderr: errWrite}.Run(argv)
	if err != nil {
		t.Fatalf("Run(%v): %v", argv, err)
	}

	// The supervisor holds no copy of these; closing them ends both drains.
	outWrite.Close()
	errWrite.Close()

	return code, <-collected, <-collected
}

func mustPipe(t *testing.T) (*os.File, *os.File) {
	t.Helper()
	read, write, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe: %v", err)
	}
	t.Cleanup(func() { read.Close() })
	return read, write
}

func drain(from *os.File, into chan<- string) {
	content, _ := io.ReadAll(from)
	into <- string(content)
}

func TestRunReportsSuccess(t *testing.T) {
	code, _, _ := capture(t, []string{"sh", "-c", "exit 0"})
	if code != 0 {
		t.Errorf("exit code = %d, want 0", code)
	}
}

func TestRunPropagatesExitCode(t *testing.T) {
	code, _, _ := capture(t, []string{"sh", "-c", "exit 42"})
	if code != 42 {
		t.Errorf("exit code = %d, want 42", code)
	}
}

func TestRunReportsSignalledChildAsShellDoes(t *testing.T) {
	code, _, _ := capture(t, []string{"sh", "-c", "kill -TERM $$"})
	if want := exitAfterSignal + int(syscall.SIGTERM); code != want {
		t.Errorf("exit code = %d, want %d", code, want)
	}
}

func TestRunForwardsBothStreams(t *testing.T) {
	code, stdout, stderr := capture(t, []string{"sh", "-c", "echo to-stdout; echo to-stderr >&2"})
	if code != 0 {
		t.Fatalf("exit code = %d, want 0", code)
	}
	if strings.TrimSpace(stdout) != "to-stdout" {
		t.Errorf("stdout = %q, want %q", stdout, "to-stdout")
	}
	if strings.TrimSpace(stderr) != "to-stderr" {
		t.Errorf("stderr = %q, want %q", stderr, "to-stderr")
	}
}

func TestRunForwardsStdinToChild(t *testing.T) {
	stdinRead, stdinWrite := mustPipe(t)
	go func() {
		io.WriteString(stdinWrite, "piped\n")
		stdinWrite.Close()
	}()

	outRead, outWrite := mustPipe(t)
	collected := make(chan string, 1)
	go drain(outRead, collected)

	code, err := Supervisor{Stdin: stdinRead, Stdout: outWrite, Stderr: outWrite}.Run(
		[]string{"sh", "-c", "read line; echo got:$line"})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	outWrite.Close()

	if code != 0 {
		t.Errorf("exit code = %d, want 0", code)
	}
	if got := strings.TrimSpace(<-collected); got != "got:piped" {
		t.Errorf("stdout = %q, want %q", got, "got:piped")
	}
}

func TestRunForwardsSignalsToChild(t *testing.T) {
	// The child reports the signal it received rather than dying from it, which
	// proves the supervisor relayed it instead of the child simply being killed.
	// It announces readiness first: a SIGTERM sent before the trap is installed
	// would kill it outright and the test would pass for the wrong reason.
	outRead, outWrite := mustPipe(t)
	childOutput := bufio.NewReader(outRead)

	type outcome struct {
		code int
		err  error
	}
	finished := make(chan outcome, 1)
	go func() {
		code, err := Supervisor{Stdout: outWrite, Stderr: outWrite}.Run([]string{
			"sh", "-c", `trap 'echo caught-term; exit 7' TERM; echo ready; while true; do sleep 0.05; done`,
		})
		finished <- outcome{code, err}
	}()

	if line := readLine(t, childOutput); line != "ready" {
		t.Fatalf("first child line = %q, want %q", line, "ready")
	}

	// Delivered to the test process; signal.Notify inside Run intercepts it, so
	// the test binary itself is not terminated.
	if err := syscall.Kill(os.Getpid(), syscall.SIGTERM); err != nil {
		t.Fatalf("Kill: %v", err)
	}

	if line := readLine(t, childOutput); line != "caught-term" {
		t.Errorf("child output = %q, want %q", line, "caught-term")
	}

	got := <-finished
	if got.err != nil {
		t.Fatalf("Run: %v", got.err)
	}
	if got.code != 7 {
		t.Errorf("exit code = %d, want 7 (the child's own handler)", got.code)
	}
}

func readLine(t *testing.T, from *bufio.Reader) string {
	t.Helper()
	line, err := from.ReadString('\n')
	if err != nil {
		t.Fatalf("reading child output: %v", err)
	}
	return strings.TrimSpace(line)
}

func TestRunRejectsEmptyArgv(t *testing.T) {
	if _, err := Default().Run(nil); !errors.Is(err, ErrNoCommand) {
		t.Errorf("err = %v, want ErrNoCommand", err)
	}
}

func TestRunFailsLoudlyOnMissingCommand(t *testing.T) {
	_, err := Default().Run([]string{"emu-no-such-command-exists"})
	if !errors.Is(err, exec.ErrNotFound) {
		t.Errorf("err = %v, want exec.ErrNotFound", err)
	}
}

func TestRunFailsLoudlyOnUnexecutableFile(t *testing.T) {
	// Caught during lookup, because LookPath checks the executable bit.
	unexecutable := writeProgram(t, "emu-unexecutable", "#!/bin/sh\n", 0o644)
	if _, err := Default().Run([]string{unexecutable}); !errors.Is(err, fs.ErrPermission) {
		t.Errorf("err = %v, want fs.ErrPermission", err)
	}
}

func TestRunFailsLoudlyOnFileThatIsNotAProgram(t *testing.T) {
	// Executable but neither ELF nor a script, so lookup succeeds and the launch
	// itself is what fails.
	notAProgram := writeProgram(t, "emu-not-a-program", "\x00not a program", 0o755)
	if _, err := Default().Run([]string{notAProgram}); !errors.Is(err, syscall.ENOEXEC) {
		t.Errorf("err = %v, want syscall.ENOEXEC", err)
	}
}

func writeProgram(t *testing.T, name, content string, mode os.FileMode) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, []byte(content), mode); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	return path
}

// TestReapDrainsUntrackedChildren covers the PID 1 duty: a process the
// supervisor did not start must still be collected, because an unreaped zombie
// holds a slot against the container's process limit.
func TestReapDrainsUntrackedChildren(t *testing.T) {
	untracked := startSleeper(t, "exit 0")
	tracked := startSleeper(t, "exit 3")

	waitForExit(t, untracked)
	waitForExit(t, tracked)

	code, exited := reap(tracked)
	if !exited {
		t.Fatal("reap did not report the tracked child as exited")
	}
	if code != 3 {
		t.Errorf("tracked exit code = %d, want 3", code)
	}
	if _, _, errno := syscall.Syscall6(syscall.SYS_WAIT4,
		uintptr(untracked), 0, syscall.WNOHANG, 0, 0, 0); errno != syscall.ECHILD {
		t.Errorf("untracked child %d was left unreaped (errno %v)", untracked, errno)
	}
}

func TestExitCodeOfNormalExit(t *testing.T) {
	var status syscall.WaitStatus // zero value is a clean exit
	if got := exitCode(status); got != 0 {
		t.Errorf("exitCode = %d, want 0", got)
	}
}

func startSleeper(t *testing.T, script string) int {
	t.Helper()
	path, err := exec.LookPath("sh")
	if err != nil {
		t.Fatalf("LookPath sh: %v", err)
	}
	child, err := os.StartProcess(path, []string{"sh", "-c", script}, &os.ProcAttr{})
	if err != nil {
		t.Fatalf("StartProcess: %v", err)
	}
	return child.Pid
}

// waitForExit blocks until the process has exited without reaping it, leaving
// the zombie in place for reap to collect.
func waitForExit(t *testing.T, pid int) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if isZombie(pid) {
			return
		}
		time.Sleep(2 * time.Millisecond)
	}
	t.Fatalf("process %d did not become a zombie within the deadline", pid)
}

func isZombie(pid int) bool {
	status, err := os.ReadFile("/proc/" + strconv.Itoa(pid) + "/stat")
	if err != nil {
		return false
	}
	// The state field follows the parenthesised command name, which may itself
	// contain spaces, so scan from the last ')'.
	fields := strings.Fields(string(status[strings.LastIndexByte(string(status), ')')+1:]))
	return len(fields) > 0 && fields[0] == "Z"
}
