package cli

import (
	"flag"
	"fmt"
	"io"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/config"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/control"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/oplog"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/supervise"
)

// runOptions are emu's own flags — everything before the separator.
type runOptions struct {
	configPath  string
	controlPath string
}

// recordsOplog reports whether this run dumps its op log. A bare "emu run --" is
// still P0's supervisor and must not add a line to the child's stdout.
func (o runOptions) recordsOplog() bool {
	return o.configPath != "" || o.controlPath != ""
}

func runChild(args []string, stdout, stderr io.Writer) int {
	options, argv, err := parseRun(args)
	if err != nil {
		return fail(stderr, err, exitUsage)
	}

	settings, err := loadConfig(options.configPath)
	if err != nil {
		return fail(stderr, err, exitConfig)
	}

	log := oplog.New(settings.LogLimit)
	// Nothing calls Before yet: this phase has no protocol code, so the
	// interceptor's only client is the dev control socket below. P3 hands it to
	// the first emulator.
	interceptor, err := control.New(settings.Faults, log)
	if err != nil {
		return fail(stderr, err, exitConfig)
	}

	if options.controlPath != "" {
		server, err := control.Listen(options.controlPath, interceptor)
		if err != nil {
			return fail(stderr, err, exitControl)
		}
		defer func() { _ = server.Close() }()
		go server.Serve()
	}

	code, err := supervise.Default().Run(argv)
	if err != nil {
		return fail(stderr, err, startFailureCode(err))
	}

	if options.recordsOplog() {
		if err := log.DumpTo(stdout); err != nil {
			return fail(stderr, err, exitControl)
		}
	}
	return code
}

// parseRun reads emu's flags from the arguments before the separator. Flags after
// it are the child's and are never looked at.
func parseRun(args []string) (runOptions, []string, error) {
	var options runOptions

	flags := flag.NewFlagSet("emu run", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	flags.StringVar(&options.configPath, "config", "", "emulators, seed data, and fault rules")
	flags.StringVar(&options.controlPath, devControlSocketFlag, "", "dev only: serve emu ctl here")

	own, argv, err := SplitCommand(args)
	if err != nil {
		return options, nil, err
	}
	if err := flags.Parse(own); err != nil {
		return options, nil, err
	}
	if extra := flags.Args(); len(extra) > 0 {
		return options, nil, fmt.Errorf("unexpected argument %q before %q", extra[0], separator)
	}
	return options, argv, nil
}

func loadConfig(path string) (config.Config, error) {
	if path == "" {
		return config.Config{}, nil
	}
	return config.Load(path)
}
