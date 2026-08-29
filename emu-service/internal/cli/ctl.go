package cli

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"strconv"
	"strings"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/control"
)

// ctlCommands maps the words a user types to the socket's command names.
var ctlCommands = map[string]string{
	"fault add":   control.CommandFaultAdd,
	"fault list":  control.CommandFaultList,
	"fault reset": control.CommandFaultReset,
	"oplog":       control.CommandOplog,
}

// ctlWords is the longest a ctl command is, in words.
const ctlWords = 2

// ctl drives an emu that is already running, over its dev control socket. There
// is no default socket path: talking to the wrong emu by accident is worse than
// typing the path.
func ctl(args []string, stdout, stderr io.Writer) int {
	request, socketPath, err := parseCtl(args)
	if err != nil {
		return fail(stderr, err, exitUsage)
	}

	response, err := control.Send(socketPath, request)
	if err != nil {
		return fail(stderr, err, exitControl)
	}
	if err := json.NewEncoder(stdout).Encode(response); err != nil {
		return fail(stderr, err, exitControl)
	}
	return 0
}

func parseCtl(args []string) (control.Request, string, error) {
	command, rest, err := ctlCommand(args)
	if err != nil {
		return control.Request{}, "", err
	}

	var rule control.Rule
	var when conditionFlag
	flags := flag.NewFlagSet("emu ctl", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	socket := flags.String("socket", "", "path of a running emu's dev control socket")
	action := flags.String("action", "", "error, delay, drop_conn, or cap")
	flags.StringVar(&rule.Match, "match", "", "<emulator>.<kind>, either segment may be *")
	flags.StringVar(&rule.Message, "message", "", "error text the client is given")
	flags.IntVar(&rule.After, "after", 0, "matching operations to let pass first")
	flags.IntVar(&rule.Times, "times", 0, "how often to fire; 0 means every time")
	flags.IntVar(&rule.Millis, "ms", 0, "milliseconds to delay by")
	flags.IntVar(&rule.Limit, "limit", 0, "capacity for the cap action")
	flags.Var(&when, "when", "gate on a gauge, e.g. depth_gte=100 (repeatable)")

	if err := flags.Parse(rest); err != nil {
		return control.Request{}, "", err
	}
	if extra := flags.Args(); len(extra) > 0 {
		return control.Request{}, "", fmt.Errorf("unexpected argument %q", extra[0])
	}
	if *socket == "" {
		return control.Request{}, "", errors.New("--socket is required: emu ctl only talks to a locally-run emu")
	}

	request := control.Request{Command: command}
	if command != control.CommandFaultAdd {
		return request, *socket, rejectRuleFlags(flags, command)
	}

	rule.Action = control.Action(*action)
	rule.When = control.Conditions(when)
	if err := rule.Validate(); err != nil {
		return control.Request{}, "", err
	}
	request.Rule = &rule
	return request, *socket, nil
}

// ctlCommand takes the leading words that name a command, longest match first so
// that "fault add" is one command rather than "fault" with a stray argument.
func ctlCommand(args []string) (command string, rest []string, err error) {
	if len(args) == 0 {
		return "", nil, errors.New("emu ctl needs a command\n\n" + usage)
	}
	for words := min(ctlWords, len(args)); words > 0; words-- {
		if command, named := ctlCommands[strings.Join(args[:words], " ")]; named {
			return command, args[words:], nil
		}
	}
	return "", nil, fmt.Errorf("unknown ctl command %q\n\n%s", strings.Join(args, " "), usage)
}

// rejectRuleFlags refuses rule flags on a command that does not carry a rule,
// rather than accepting them and silently doing nothing with them.
func rejectRuleFlags(flags *flag.FlagSet, command string) error {
	var offending string
	flags.Visit(func(set *flag.Flag) {
		if set.Name != "socket" && offending == "" {
			offending = set.Name
		}
	})
	if offending != "" {
		return fmt.Errorf("%s does not take --%s", command, offending)
	}
	return nil
}

// A conditionFlag collects repeated --when <gauge>_gte=<n> pairs into the
// conditions a rule is gated on.
type conditionFlag control.Conditions

func (c conditionFlag) String() string { return fmt.Sprint(control.Conditions(c)) }

func (c *conditionFlag) Set(value string) error {
	gauge, bound, found := strings.Cut(value, "=")
	if !found {
		return fmt.Errorf("want <gauge>_gte=<n>, got %q", value)
	}
	number, err := strconv.Atoi(bound)
	if err != nil {
		return fmt.Errorf("condition %q: %w", value, err)
	}
	if *c == nil {
		*c = conditionFlag{}
	}
	(*c)[gauge] = number
	return nil
}
