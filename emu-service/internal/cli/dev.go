package cli

import (
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"syscall"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/control"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/fleet"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/oplog"
)

// defaultBind is where `emu dev` puts the dashboard. A default is safe here in a
// way a default socket path is not: binding is exclusive, so a second emu on the
// same port fails loudly instead of quietly driving the wrong process.
const defaultBind = "127.0.0.1:9100"

// devOptions are `emu dev`'s flags.
type devOptions struct {
	bind       string
	configPath string
}

// dev serves the dashboard against an emu with no child process — the tool every
// emulator from P3 on is developed against.
func dev(args []string, stdout, stderr io.Writer) int {
	options, err := parseDev(args)
	if err != nil {
		return fail(stderr, err, exitUsage)
	}
	return serveDashboard(options, stdout, stderr, waitForInterrupt)
}

// serveDashboard takes until as an argument so tests can drive a real server
// instead of a signal; production passes waitForInterrupt.
func serveDashboard(options devOptions, stdout, stderr io.Writer, until func(url string)) int {
	settings, err := loadConfig(options.configPath)
	if err != nil {
		return fail(stderr, err, exitConfig)
	}

	log := oplog.New(settings.LogLimit)
	interceptor, err := control.New(settings.Faults, log)
	if err != nil {
		return fail(stderr, err, exitConfig)
	}

	// The dashboard is the tool every emulator is developed against, so it drives
	// real ones rather than a description of them.
	services, err := fleet.Start(settings, interceptor)
	if err != nil {
		return fail(stderr, err, startupCode(err))
	}
	defer func() { _ = services.Close() }()

	dashboard, err := control.Bind(options.bind, interceptor, control.About{
		Services:   settings.Services,
		Listening:  services.Addresses(),
		ConfigPath: options.configPath,
	}, control.NewRunner())
	if err != nil {
		return fail(stderr, err, exitControl)
	}
	defer func() { _ = dashboard.Close() }()
	go dashboard.Serve()

	fmt.Fprintf(stderr, "emu dev: dashboard on %s — no child process, stop with ctrl-c\n", dashboard.URL())
	until(dashboard.URL())

	if err := log.DumpTo(stdout); err != nil {
		return fail(stderr, err, exitControl)
	}
	return 0
}

func parseDev(args []string) (devOptions, error) {
	var options devOptions

	flags := flag.NewFlagSet("emu dev", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	flags.StringVar(&options.bind, "bind", defaultBind, "loopback address for the dashboard")
	flags.StringVar(&options.configPath, "config", "", "emulators, seed data, and fault rules")

	if err := flags.Parse(args); err != nil {
		return options, err
	}
	if extra := flags.Args(); len(extra) > 0 {
		return options, fmt.Errorf("unexpected argument %q", extra[0])
	}
	return options, nil
}

// waitForInterrupt blocks until the operator stops emu.
func waitForInterrupt(string) {
	interrupts := make(chan os.Signal, 1)
	signal.Notify(interrupts, syscall.SIGINT, syscall.SIGTERM)
	defer signal.Stop(interrupts)

	<-interrupts
}
