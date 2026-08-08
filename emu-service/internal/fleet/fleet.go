// Package fleet turns the services a lesson declared into emulators that are
// already listening before the child process starts.
//
// It is the only place a service name becomes a running emulator, and the only
// place that knows which services have one yet. Nothing is constructed or bound
// that the lesson did not ask for, which is most of what keeps emu small.
package fleet

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/config"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/control"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/emulator"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/pgwire"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/sqlitedb"
)

// loopback is the only interface an emulator is offered on. The sandbox has no
// network at all, and outside it nobody else's client should be able to reach a
// lesson's database.
const loopback = "127.0.0.1"

// ErrBind marks a port that could not be taken. That is a problem with the
// machine rather than with the lesson — usually a real Postgres already on 5432.
var ErrBind = errors.New("binding")

// Listen is how an emulator takes its port. Production never changes it. emu's
// own tests do, because `go test` must not need the port a real Postgres wants —
// this repository's docker-compose already publishes 5432, and a test suite that
// cannot run while the app is up is a test suite nobody runs.
var Listen = net.Listen

// builders is where a config's service name becomes an emulator. A service
// listed in config.KnownServices but missing here is one whose phase has not
// landed, and saying so beats a lesson that silently never had a cache.
var builders = map[string]func() (*emulator.Emulator, error){
	"postgres": postgres,
	"redis":    redis,
	"queue":    queue,
}

func postgres() (*emulator.Emulator, error) {
	backend, err := sqlitedb.New()
	if err != nil {
		return nil, err
	}
	return &emulator.Emulator{Proto: pgwire.New(), Backend: backend}, nil
}

// A Fleet is one lesson's emulators, bound and serving.
type Fleet struct {
	listeners []net.Listener
	backends  []emulator.Backend
	addresses map[string]string
}

// Start builds, seeds, and binds every declared service. A failure anywhere
// tears down what already started, because a run with half its infrastructure
// would grade students on a machine the lesson does not describe.
func Start(settings config.Config, intercept *control.Interceptor) (*Fleet, error) {
	fleet := &Fleet{addresses: map[string]string{}}
	for _, service := range settings.Services {
		if err := fleet.add(service, settings.Seed[service], intercept); err != nil {
			_ = fleet.Close()
			return nil, err
		}
	}
	return fleet, nil
}

// Addresses is where each service ended up, for the dashboard to point a client
// at.
func (f *Fleet) Addresses() map[string]string { return f.addresses }

// Close stops listening and drops every emulator's state. Nothing persists
// between runs.
func (f *Fleet) Close() error {
	var failure error
	for _, listener := range f.listeners {
		failure = errors.Join(failure, listener.Close())
	}
	for _, backend := range f.backends {
		failure = errors.Join(failure, backend.Close())
	}
	f.listeners, f.backends = nil, nil
	return failure
}

func (f *Fleet) add(service string, seed json.RawMessage, intercept *control.Interceptor) error {
	build, ready := builders[service]
	if !ready {
		return fmt.Errorf("service %q has no emulator yet — see the phases in plans/emu-service.md", service)
	}

	built, err := build()
	if err != nil {
		return fmt.Errorf("starting %s: %w", service, err)
	}
	f.backends = append(f.backends, built.Backend)

	if err := built.Backend.Seed(seed); err != nil {
		return err
	}

	address := fmt.Sprintf("%s:%d", loopback, built.Proto.Port())
	listener, err := Listen("tcp", address)
	if err != nil {
		return fmt.Errorf("%w %s on %s: %w", ErrBind, service, address, err)
	}
	f.listeners = append(f.listeners, listener)
	f.addresses[service] = listener.Addr().String()

	go built.Serve(listener, intercept)
	return nil
}
