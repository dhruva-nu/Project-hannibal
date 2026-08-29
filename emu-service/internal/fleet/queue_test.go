package fleet

import (
	"encoding/json"
	"net"
	"strings"
	"testing"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/amqp"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/config"
)

func TestTheQueueIsWhatTheRegistryBuildsForThatName(t *testing.T) {
	built, err := builders["queue"]()

	if err != nil {
		t.Fatalf("building the queue: %v", err)
	}
	defer func() { _ = built.Backend.Close() }()

	if built.Proto.Name() != "queue" || built.Proto.Port() != amqp.Port {
		t.Errorf("built %s on %d, want queue on %d", built.Proto.Name(), built.Proto.Port(), amqp.Port)
	}
}

func TestTheQueueIsSeededAndListeningBeforeTheChildStarts(t *testing.T) {
	onEphemeralPorts(t)

	services, err := Start(config.Config{
		Services: []string{"queue"},
		Seed: map[string]json.RawMessage{
			"queue": json.RawMessage(`{"queues": [{"name": "jobs", "messages": ["waiting"]}]}`),
		},
	}, interceptor(t))

	if err != nil {
		t.Fatalf("Start = %v", err)
	}
	t.Cleanup(func() { _ = services.Close() })

	conn, err := net.Dial("tcp", services.Addresses()["queue"])
	if err != nil {
		t.Fatalf("nothing is listening for the queue: %v", err)
	}
	_ = conn.Close()
}

func TestAQueueSeedThatCannotBeBuiltFailsTheRun(t *testing.T) {
	onEphemeralPorts(t)

	_, err := Start(config.Config{
		Services: []string{"queue"},
		Seed:     map[string]json.RawMessage{"queue": json.RawMessage(`{"exchanges": [{"name": "e", "type": "gossip"}]}`)},
	}, interceptor(t))

	if err == nil || !strings.Contains(err.Error(), "seed for queue") {
		t.Errorf("Start = %v, want the seed blamed", err)
	}
}
