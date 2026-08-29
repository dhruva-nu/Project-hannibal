// Package config loads the only control a lesson run gets: which emulators to
// start, what to seed them with, and which faults to arm.
//
// It deliberately has no field that can open a control channel. A lesson author
// influences this file, while only rce-service builds emu's argv, so the control
// socket has to be unreachable from here — see the threat model in
// plans/emu-service.md. Unknown fields are rejected outright, which means a
// config that asks for a control channel fails the run instead of being ignored.
package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"os"
	"slices"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/control"
)

// KnownServices are the emulators a config may declare. P3–P6 give them
// implementations; validating against this list now turns a typo in a lesson into
// a failed run rather than a service that silently never starts.
var KnownServices = []string{"postgres", "redis", "queue", "mongo"}

// A Config is one lesson's emulator setup.
type Config struct {
	// Services are the emulators to start. Only what a lesson declares is ever
	// constructed or bound, which is most of what keeps emu small.
	Services []string `json:"services"`
	// Seed is per-service seed data, kept as raw JSON because only the backend
	// that consumes it knows its shape.
	Seed map[string]json.RawMessage `json:"seed"`
	// Faults are the rules armed before the child starts.
	Faults []control.Rule `json:"faults"`
	// LogLimit bounds the op log. Zero means oplog.DefaultLimit.
	LogLimit int `json:"log_limit"`
}

// Load reads and validates the config at path.
func Load(path string) (Config, error) {
	file, err := os.Open(path)
	if err != nil {
		return Config{}, fmt.Errorf("reading the config: %w", err)
	}
	defer func() { _ = file.Close() }()

	config, err := Parse(file)
	if err != nil {
		return Config{}, fmt.Errorf("%s: %w", path, err)
	}
	return config, nil
}

// Parse decodes and validates a config.
func Parse(reader io.Reader) (Config, error) {
	decoder := json.NewDecoder(reader)
	decoder.DisallowUnknownFields()

	var config Config
	if err := decoder.Decode(&config); err != nil {
		return Config{}, err
	}
	return config, config.validate()
}

func (c Config) validate() error {
	if len(c.Services) == 0 {
		return errors.New("services is empty: a run with no emulators has nothing to configure")
	}
	if c.LogLimit < 0 {
		return fmt.Errorf("log_limit %d cannot be negative", c.LogLimit)
	}
	if err := c.validateServices(); err != nil {
		return err
	}
	if err := c.validateSeed(); err != nil {
		return err
	}
	return c.validateFaults()
}

func (c Config) validateServices() error {
	for index, service := range c.Services {
		if !slices.Contains(KnownServices, service) {
			return fmt.Errorf("unknown service %q: want one of %v", service, KnownServices)
		}
		if slices.Contains(c.Services[:index], service) {
			return fmt.Errorf("service %q declared twice", service)
		}
	}
	return nil
}

// validateSeed rejects seed data for a service the lesson never starts, which
// would otherwise look like it had been applied.
func (c Config) validateSeed() error {
	for _, service := range slices.Sorted(maps.Keys(c.Seed)) {
		if !slices.Contains(c.Services, service) {
			return fmt.Errorf("seed for %q, which services does not declare", service)
		}
	}
	return nil
}

// validateFaults rejects a fault aimed at a service the lesson never starts. Such
// a rule can never fire, and a lesson that grades fault handling would pass
// everyone.
//
// Whether the rule itself is well formed is control.Rule's business, checked when
// the interceptor arms it — which also happens before the child starts, so a
// broken rule still fails the run rather than the student.
func (c Config) validateFaults() error {
	for _, rule := range c.Faults {
		emulator := control.PatternEmulator(rule.Match)
		if emulator != control.Wildcard && !slices.Contains(c.Services, emulator) {
			return fmt.Errorf("fault on %q, but services does not declare %q", rule.Match, emulator)
		}
	}
	return nil
}
