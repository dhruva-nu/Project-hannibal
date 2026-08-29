package fleet

import (
	"encoding/json"
	"errors"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/config"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/control"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/mongowire"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/oplog"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/pgwire"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/resp"
)

// onEphemeralPorts sends every emulator to a port the machine picked, so that the
// suite runs while this repository's own Postgres is on 5432.
func onEphemeralPorts(t *testing.T) {
	t.Helper()

	taken := Listen
	Listen = func(network, address string) (net.Listener, error) {
		host, _, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		return taken(network, host+":0")
	}
	t.Cleanup(func() { Listen = taken })
}

func interceptor(t *testing.T) *control.Interceptor {
	t.Helper()

	intercept, err := control.New(nil, oplog.New(0))
	if err != nil {
		t.Fatalf("arming rules: %v", err)
	}
	return intercept
}

func TestOnlyWhatTheLessonDeclaredIsBuiltAndBound(t *testing.T) {
	onEphemeralPorts(t)

	services, err := Start(config.Config{
		Services: []string{"postgres"},
		Seed:     map[string]json.RawMessage{"postgres": json.RawMessage(`["CREATE TABLE t (id INT)"]`)},
	}, interceptor(t))

	if err != nil {
		t.Fatalf("Start = %v", err)
	}
	t.Cleanup(func() { _ = services.Close() })

	address, listening := services.Addresses()["postgres"]
	if !listening {
		t.Fatalf("addresses = %v, want postgres among them", services.Addresses())
	}
	conn, err := net.Dial("tcp", address)
	if err != nil {
		t.Fatalf("nothing is listening on %s: %v", address, err)
	}
	_ = conn.Close()
}

// As of P6 every name in config.KnownServices has a builder, so no real service
// reaches this branch any more — config.Parse rejects anything else before Start
// ever sees it. The branch stays because the next phase to add a name to the known
// list before writing its builder is the case it exists for, and this test stands
// in for that phase: a name fleet has no builder for, whatever config thinks of it.
func TestAServiceWithNoEmulatorYetFailsTheRunRatherThanGoingMissing(t *testing.T) {
	onEphemeralPorts(t)
	const unbuilt = "search"
	if _, built := builders[unbuilt]; built {
		t.Fatalf("%q has a builder now; pick a service that does not for this test", unbuilt)
	}

	_, err := Start(config.Config{Services: []string{unbuilt}}, interceptor(t))

	if err == nil || !strings.Contains(err.Error(), "no emulator yet") {
		t.Errorf("Start = %v, want it to say %s has not been built", err, unbuilt)
	}
}

func TestSeedDataThatCannotBeAppliedFailsTheRun(t *testing.T) {
	onEphemeralPorts(t)

	_, err := Start(config.Config{
		Services: []string{"postgres"},
		Seed:     map[string]json.RawMessage{"postgres": json.RawMessage(`["CREATE TABLE ("]`)},
	}, interceptor(t))

	if err == nil || !strings.Contains(err.Error(), "seed for postgres") {
		t.Errorf("Start = %v, want the seed blamed", err)
	}
}

func TestAPortThatIsAlreadyTakenIsBlamedOnTheMachine(t *testing.T) {
	// Something else on 5432 is not the lesson's fault, and the exit code says so.
	held, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listening: %v", err)
	}
	defer func() { _ = held.Close() }()

	taken := Listen
	Listen = func(string, string) (net.Listener, error) {
		return taken("tcp", held.Addr().String())
	}
	t.Cleanup(func() { Listen = taken })

	_, err = Start(config.Config{Services: []string{"postgres"}}, interceptor(t))

	if !errors.Is(err, ErrBind) {
		t.Errorf("Start = %v, want it marked as a binding failure", err)
	}
	if err == nil || !strings.Contains(err.Error(), "127.0.0.1:5432") {
		t.Errorf("Start = %v, want the address it wanted named", err)
	}
}

func TestAFailedStartTakesDownWhatAlreadyStarted(t *testing.T) {
	// Two of a service cannot both bind, so the second is where this fails — and
	// the first must not be left listening behind it.
	onEphemeralPorts(t)
	first, err := Start(config.Config{Services: []string{"postgres"}}, interceptor(t))
	if err != nil {
		t.Fatalf("Start = %v", err)
	}
	if err := first.Close(); err != nil {
		t.Fatalf("Close = %v", err)
	}

	Listen = func(string, string) (net.Listener, error) {
		return nil, errors.New("no ports today")
	}

	services, err := Start(config.Config{
		Services: []string{"postgres"},
		Seed:     map[string]json.RawMessage{"postgres": json.RawMessage(`["CREATE TABLE t (id INT)"]`)},
	}, interceptor(t))

	if err == nil {
		_ = services.Close()
		t.Fatal("Start succeeded with no port to take")
	}
}

func TestCloseIsSafeToCallTwice(t *testing.T) {
	onEphemeralPorts(t)
	services, err := Start(config.Config{Services: []string{"postgres"}}, interceptor(t))
	if err != nil {
		t.Fatalf("Start = %v", err)
	}

	if err := services.Close(); err != nil {
		t.Fatalf("first Close = %v", err)
	}
	if err := services.Close(); err != nil {
		t.Errorf("second Close = %v, want nothing left to do", err)
	}
}

func TestPostgresIsWhatTheRegistryBuildsForThatName(t *testing.T) {
	built, err := builders["postgres"]()

	if err != nil {
		t.Fatalf("building postgres: %v", err)
	}
	defer func() { _ = built.Backend.Close() }()

	if built.Proto.Name() != "postgres" || built.Proto.Port() != pgwire.Port {
		t.Errorf("built %s on %d, want postgres on %d", built.Proto.Name(), built.Proto.Port(), pgwire.Port)
	}
}

func TestRedisIsWhatTheRegistryBuildsForThatName(t *testing.T) {
	built, err := builders["redis"]()

	if err != nil {
		t.Fatalf("building redis: %v", err)
	}
	defer func() { _ = built.Backend.Close() }()

	if built.Proto.Name() != "redis" || built.Proto.Port() != resp.Port {
		t.Errorf("built %s on %d, want redis on %d", built.Proto.Name(), built.Proto.Port(), resp.Port)
	}
}

func TestEveryDeclaredServiceGetsItsOwnPort(t *testing.T) {
	onEphemeralPorts(t)

	services, err := Start(config.Config{
		Services: []string{"postgres", "redis"},
		Seed:     map[string]json.RawMessage{"redis": json.RawMessage(`{"rate:1": "0"}`)},
	}, interceptor(t))

	if err != nil {
		t.Fatalf("Start = %v", err)
	}
	t.Cleanup(func() { _ = services.Close() })

	addresses := services.Addresses()
	if len(addresses) != 2 || addresses["postgres"] == addresses["redis"] {
		t.Fatalf("addresses = %v, want one apiece", addresses)
	}
	for service, address := range addresses {
		conn, err := net.Dial("tcp", address)
		if err != nil {
			t.Errorf("nothing is listening for %s on %s: %v", service, address, err)
			continue
		}
		_ = conn.Close()
	}
}

func TestSeedDataTheCacheCannotReadFailsTheRun(t *testing.T) {
	onEphemeralPorts(t)

	_, err := Start(config.Config{
		Services: []string{"redis"},
		Seed:     map[string]json.RawMessage{"redis": json.RawMessage(`["SET k v"]`)},
	}, interceptor(t))

	if err == nil || !strings.Contains(err.Error(), "seed for redis") {
		t.Errorf("Start = %v, want the seed blamed", err)
	}
}

func TestMongoIsWhatTheRegistryBuildsForThatName(t *testing.T) {
	built, err := builders["mongo"]()

	if err != nil {
		t.Fatalf("building mongo: %v", err)
	}
	defer func() { _ = built.Backend.Close() }()

	if built.Proto.Name() != "mongo" || built.Proto.Port() != mongowire.Port {
		t.Errorf("built %s on %d, want mongo on %d", built.Proto.Name(), built.Proto.Port(), mongowire.Port)
	}
}

// The document database's protocol is handed the store as well as fronting it,
// which the SQL emulator does not need. Starting it through the fleet is what
// proves the two halves were wired to each other.
func TestTheDocumentDatabaseStartsSeededAndListening(t *testing.T) {
	onEphemeralPorts(t)

	services, err := Start(config.Config{
		Services: []string{"mongo"},
		Seed:     map[string]json.RawMessage{"mongo": json.RawMessage(`{"orders": [{"sku": "abc"}]}`)},
	}, interceptor(t))
	if err != nil {
		t.Fatalf("Start = %v", err)
	}
	t.Cleanup(func() { _ = services.Close() })

	address, listening := services.Addresses()["mongo"]
	if !listening {
		t.Fatalf("addresses = %v, want mongo among them", services.Addresses())
	}
	conn, err := net.Dial("tcp", address)
	if err != nil {
		t.Fatalf("nothing is listening on %s: %v", address, err)
	}
	_ = conn.Close()
}

func TestSeedTheDocumentStoreCannotReadFailsTheRun(t *testing.T) {
	onEphemeralPorts(t)

	_, err := Start(config.Config{
		Services: []string{"mongo"},
		Seed:     map[string]json.RawMessage{"mongo": json.RawMessage(`["orders"]`)},
	}, interceptor(t))

	if err == nil || !strings.Contains(err.Error(), "seed for mongo") {
		t.Errorf("Start = %v, want the seed blamed", err)
	}
}

func TestAnEmulatorThatCannotBeBuiltNamesTheServiceItIsFor(t *testing.T) {
	onEphemeralPorts(t)
	// A temp directory that is a file, so the SQL database has nowhere to live.
	blocked := filepath.Join(t.TempDir(), "not-a-directory")
	if err := os.WriteFile(blocked, nil, 0o600); err != nil {
		t.Fatalf("writing the blocker: %v", err)
	}
	t.Setenv("TMPDIR", blocked)

	_, err := Start(config.Config{Services: []string{"postgres"}}, interceptor(t))

	if err == nil || !strings.Contains(err.Error(), "starting postgres") {
		t.Errorf("Start = %v, want the service named", err)
	}
}
