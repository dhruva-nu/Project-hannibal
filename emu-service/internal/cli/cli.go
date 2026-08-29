// Package cli parses emu's command line and reports a process exit code.
package cli

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os/exec"
	"strings"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/fleet"
)

const usage = `emu — infrastructure emulators for the code execution sandbox

usage:
  emu run [flags] -- <command> [args...]   run <command>, supervised
  emu dev [flags]                          serve the dashboard, no child process
  emu ctl <command> --socket <path>        drive a locally-running emu (dev only)
  emu install <path>                       copy this binary to <path>
  emu help                                 show this message

run flags:
  --config <path>               which emulators to start, their seed data, and
                                the fault rules to arm
  --dev-control-socket <path>   serve "emu ctl" on a Unix socket
  --dev-control-bind <addr>     serve the dashboard on a loopback address

  Both control flags are DEV ONLY and never passed by rce-service: student code
  shares emu's uid, so a control channel it can reach lets the code being graded
  disarm the faults grading it.

dev flags:
  --bind <addr>                 loopback address for the dashboard
                                (default 127.0.0.1:9100)
  --config <path>               same config a lesson run would get

ctl commands:
  fault add    --match <pattern> --action <error|delay|drop_conn|cap>
               [--after N] [--times N] [--ms N] [--limit N] [--message TEXT]
               [--when <gauge>_gte=N]
  fault list
  fault reset
  oplog

install exists because the shipped image is FROM scratch and has no shell: the
binary copies itself into the named volume that rce-service mounts read-only
into the run container.

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

// The control-channel flags exist only here, on argv. Nothing in the config
// loader can reach either — see the threat model in plans/emu-service.md.
const (
	devControlSocketFlag = "dev-control-socket"
	devControlBindFlag   = "dev-control-bind"
)

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
	case "dev":
		return dev(args[1:], stdout, stderr)
	case "ctl":
		return ctl(args[1:], stdout, stderr)
	case "install":
		return install(args[1:], stderr)
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

// startupCode separates a lesson emu could not honour from a machine it could
// not run on: a port already taken is not the config's fault, and a lesson
// author reading exit 78 should be looking at their config.
func startupCode(err error) int {
	if errors.Is(err, fleet.ErrBind) {
		return exitControl
	}
	return exitConfig
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
