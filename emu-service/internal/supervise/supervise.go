// Package supervise runs a child process as PID 1 of the sandbox container.
//
// The emulators a later phase adds must be listening before the child's first
// connect() attempt, which is why emu takes the container's single command slot
// and starts the child itself rather than being backgrounded alongside it.
package supervise

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"syscall"
)

// ErrNoCommand reports an empty argv, which is always a caller bug rather than a
// child that failed.
var ErrNoCommand = errors.New("no command to run")

// signalBuffer must stay larger than the number of signals registered below.
//
// That inequality is what makes exit detection safe against a hostile child.
// os/signal drops a notification rather than blocking when the channel is full,
// so a dropped SIGCHLD would hang the run until the sandbox timeout. It cannot
// happen: the runtime coalesces pending signals into one bit per signal number
// before the channel send, so at most one entry per registered signal is ever
// queued. A child flooding PID 1 therefore cannot crowd out its own exit.
//
// Grow this if the registration list grows.
const signalBuffer = 8

// exitAfterSignal matches the shell convention of reporting a signal-terminated
// process as 128 plus the signal number.
const exitAfterSignal = 128

// A Supervisor runs one child process with the given standard streams.
type Supervisor struct {
	Stdin  *os.File
	Stdout *os.File
	Stderr *os.File

	// Started, when set, is called once with the child as soon as it exists. A
	// caller that did not fork the child itself has no other way to signal it —
	// the dev dashboard's stop button is the reason this exists.
	Started func(*os.Process)
}

// Default supervises using the process's own standard streams.
func Default() Supervisor {
	return Supervisor{Stdin: os.Stdin, Stdout: os.Stdout, Stderr: os.Stderr}
}

// Run starts argv, forwards termination signals to it, reaps any orphan that
// PID 1 duty hands us, and returns the child's exit code.
//
// The returned error covers only failures to start; a child that runs and fails
// is reported through the exit code, exactly as the sandbox reports it today.
func (s Supervisor) Run(argv []string) (int, error) {
	if len(argv) == 0 {
		return 0, ErrNoCommand
	}

	// Registered before the child exists so its SIGCHLD cannot be missed.
	notifications := make(chan os.Signal, signalBuffer)
	signal.Notify(notifications, syscall.SIGCHLD, syscall.SIGTERM, syscall.SIGINT, syscall.SIGQUIT, syscall.SIGHUP)
	defer signal.Stop(notifications)

	child, err := s.start(argv)
	if err != nil {
		return 0, err
	}
	if s.Started != nil {
		s.Started(child)
	}

	// signal.Notify never closes the channel, so the only way out is the child's
	// exit status.
	for {
		notification := <-notifications
		if notification != syscall.SIGCHLD {
			// Best effort: a child that already exited leaves nothing to signal,
			// and its status is about to arrive as SIGCHLD anyway.
			//
			// The sender is not knowable here, so a SIGTERM the child sent to
			// PID 1 is relayed straight back to it. That is the child signalling
			// itself, which is its own business; the signal that matters is the
			// one `docker stop` sends.
			_ = child.Signal(notification)
			continue
		}
		if code, exited := reap(child.Pid); exited {
			return code, nil
		}
	}
}

// start launches argv with the supervisor's streams passed through as file
// descriptors, so the child's output streams straight to the caller without an
// intermediate copy.
func (s Supervisor) start(argv []string) (*os.Process, error) {
	path, err := exec.LookPath(argv[0])
	if err != nil {
		return nil, fmt.Errorf("locating %q: %w", argv[0], err)
	}
	child, err := os.StartProcess(path, argv, &os.ProcAttr{
		Files: []*os.File{s.Stdin, s.Stdout, s.Stderr},
	})
	if err != nil {
		return nil, fmt.Errorf("starting %q: %w", argv[0], err)
	}
	return child, nil
}

// reap collects every child whose status is pending, reporting the supervised
// child's exit code if it was among them.
//
// Orphaned grandchildren are reparented to PID 1, and an unreaped zombie holds a
// slot against the container's process limit, so draining them is the reason
// this loop takes -1 rather than waiting on the tracked pid alone.
func reap(supervised int) (code int, exited bool) {
	for {
		var status syscall.WaitStatus
		pid, err := syscall.Wait4(-1, &status, syscall.WNOHANG, nil)
		if pid <= 0 || err != nil {
			// pid 0: children remain but none have exited. ECHILD: none left.
			return code, exited
		}
		if pid == supervised {
			code, exited = exitCode(status), true
		}
	}
}

func exitCode(status syscall.WaitStatus) int {
	if status.Signaled() {
		return exitAfterSignal + int(status.Signal())
	}
	return status.ExitStatus()
}
