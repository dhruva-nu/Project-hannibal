// Package cli parses emu's command line and reports a process exit code.
package cli

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os/exec"
	"strings"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/supervise"
)

const usage = `emu — infrastructure emulators for the code execution sandbox

usage:
  emu run -- <command> [args...]   run <command>, supervised
  emu help                        show this message

emu takes the container's command slot and runs <command> as its child, so that
later phases can have emulators listening before the child's first connect().`

// Exit codes for problems with the command line itself or with launching the
// child, chosen to match the shell so students see familiar numbers.
const (
	exitUsage         = 2
	exitNotExecutable = 126
	exitNotFound      = 127
)

// separator must appear before the supervised command so the boundary between
// emu's own arguments and the child's is never ambiguous.
const separator = "--"

// Run executes one emu invocation and returns the code the process should exit
// with. Diagnostics from emu itself go to stderr; the child's own streams are
// passed through untouched.
func Run(args []string, stderr io.Writer) int {
	if len(args) == 0 {
		return fail(stderr, errors.New("no command given\n\n"+usage), exitUsage)
	}

	switch args[0] {
	case "help", "-h", "--help":
		fmt.Fprintln(stderr, usage)
		return 0
	case "run":
		return runChild(args[1:], stderr)
	default:
		return fail(stderr, fmt.Errorf("unknown command %q\n\n%s", args[0], usage), exitUsage)
	}
}

func runChild(args []string, stderr io.Writer) int {
	argv, err := SplitCommand(args)
	if err != nil {
		return fail(stderr, err, exitUsage)
	}

	code, err := supervise.Default().Run(argv)
	if err != nil {
		return fail(stderr, err, startFailureCode(err))
	}
	return code
}

// SplitCommand returns the child argv that follows the mandatory separator.
func SplitCommand(args []string) ([]string, error) {
	for i, arg := range args {
		if arg != separator {
			continue
		}
		argv := args[i+1:]
		if len(argv) == 0 {
			return nil, fmt.Errorf("no command after %q", separator)
		}
		if before := args[:i]; len(before) > 0 {
			return nil, fmt.Errorf("unexpected argument %q before %q", before[0], separator)
		}
		return argv, nil
	}
	return nil, fmt.Errorf("missing %q before the command", separator)
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
