// Package cli parses emu's command line and reports a process exit code.
package cli

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os/exec"
	"strings"
)

const usage = `emu — infrastructure emulators for the code execution sandbox

usage:
  emu run [flags] -- <command> [args...]   run <command>, supervised
  emu ctl <command> --socket <path>        drive a locally-running emu (dev only)
  emu help                                 show this message

run flags:
  --config <path>               which emulators to start, their seed data, and
                                the fault rules to arm
  --dev-control-socket <path>   serve "emu ctl" on a Unix socket. DEV ONLY, and
                                never passed by rce-service: student code shares
                                emu's uid, so a reachable socket lets the code
                                being graded disarm the faults grading it.

ctl commands:
  fault add    --match <pattern> --action <error|delay|drop_conn|cap>
               [--after N] [--times N] [--ms N] [--limit N] [--message TEXT]
               [--when <gauge>_gte=N]
  fault list
  fault reset
  oplog

emu takes the container's command slot and runs <command> as its child, so that
the emulators are listening before the child's first connect().`

// Exit codes for problems with the command line, the config, or launching the
// child, chosen to match the shell and sysexits so students and rce-service both
// see familiar numbers.
const (
	exitUsage         = 2
	exitControl       = 1
	exitConfig        = 78 // EX_CONFIG: the config is bad, not the command line
	exitNotExecutable = 126
	exitNotFound      = 127
)

// separator must appear before the supervised command so the boundary between
// emu's own arguments and the child's is never ambiguous.
const separator = "--"

// devControlSocketFlag exists only here, on argv. Nothing in the config loader
// can reach it — see the threat model in plans/emu-service.md.
const devControlSocketFlag = "dev-control-socket"

// Run executes one emu invocation and returns the code the process should exit
// with. Diagnostics from emu itself go to stderr, the op log to stdout, and the
// child's own streams are passed through untouched.
func Run(args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		return fail(stderr, errors.New("no command given\n\n"+usage), exitUsage)
	}

	switch args[0] {
	case "help", "-h", "--help":
		fmt.Fprintln(stderr, usage)
		return 0
	case "run":
		return runChild(args[1:], stdout, stderr)
	case "ctl":
		return ctl(args[1:], stdout, stderr)
	default:
		return fail(stderr, fmt.Errorf("unknown command %q\n\n%s", args[0], usage), exitUsage)
	}
}

// SplitCommand separates emu's own arguments from the child argv at the first
// separator. Separators after it belong to the child.
func SplitCommand(args []string) (own, argv []string, err error) {
	for index, arg := range args {
		if arg != separator {
			continue
		}
		if argv = args[index+1:]; len(argv) == 0 {
			return nil, nil, fmt.Errorf("no command after %q", separator)
		}
		return args[:index], argv, nil
	}
	return nil, nil, fmt.Errorf("missing %q before the command", separator)
}

// startFailureCode distinguishes a missing command from one that cannot be
// executed, so a typo in a lesson's command is obvious from the exit code alone.
func startFailureCode(err error) int {
	switch {
	case errors.Is(err, exec.ErrNotFound):
		return exitNotFound
	case errors.Is(err, fs.ErrPermission):
		return exitNotExecutable
	default:
		return 1
	}
}

func fail(stderr io.Writer, err error, code int) int {
	message := err.Error()
	if !strings.HasSuffix(message, "\n") {
		message += "\n"
	}
	fmt.Fprintf(stderr, "emu: %s", message)
	return code
}
