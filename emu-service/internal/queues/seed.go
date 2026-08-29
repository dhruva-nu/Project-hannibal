package queues

import (
	"bytes"
	"encoding/json"
	"fmt"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/mq"
)

// A topology is the queue seed a lesson writes: the exchanges and queues that
// exist before the student's first line runs, and what is already waiting in
// them.
//
//	"queue": {
//	  "exchanges": [{"name": "events", "type": "topic"}],
//	  "queues": [
//	    {"name": "orders",
//	     "bind": [{"exchange": "events", "routing_key": "order.*"}],
//	     "messages": ["{\"id\": 1}", "{\"id\": 2}"]}
//	  ]
//	}
//
// Messages are bodies and nothing else. Content type, headers, and the rest of
// AMQP's properties are a publisher's business, and a lesson that needs them can
// publish the message itself in a line of setup — which is also the version a
// student can read.
type topology struct {
	Exchanges []seedExchange `json:"exchanges"`
	Queues    []seedQueue    `json:"queues"`
}

type seedExchange struct {
	Name string `json:"name"`
	Kind string `json:"type"`
}

type seedQueue struct {
	Name     string     `json:"name"`
	Bind     []seedBind `json:"bind"`
	Messages []string   `json:"messages"`
}

type seedBind struct {
	Exchange   string `json:"exchange"`
	RoutingKey string `json:"routing_key"`
}

// Seed builds that topology before any client can connect. Anything it cannot
// build fails the run: a lesson whose fixture did not load would grade students
// against a broker that is not the one it describes.
func (b *Backend) Seed(raw json.RawMessage) error {
	if len(raw) == 0 {
		return nil
	}

	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()

	var seed topology
	if err := decoder.Decode(&seed); err != nil {
		return fmt.Errorf("seed for queue: %w", err)
	}

	b.mutex.Lock()
	defer b.mutex.Unlock()

	if err := b.seedExchanges(seed.Exchanges); err != nil {
		return err
	}
	return b.seedQueues(seed.Queues)
}

func (b *Backend) seedExchanges(exchanges []seedExchange) error {
	for _, declared := range exchanges {
		if err := b.declareExchange(declared.Name, declared.Kind, false); err != nil {
			return fmt.Errorf("seed for queue: %w", err)
		}
	}
	return nil
}

func (b *Backend) seedQueues(queues []seedQueue) error {
	for _, declared := range queues {
		if declared.Name == "" {
			return fmt.Errorf("seed for queue: a queue needs a name — only a client may leave one to the server")
		}
		// A non-passive declaration of a named queue is the one form of declare
		// that cannot fail, so there is no error here to report.
		target, _ := b.declare(declared.Name, mq.Declare{})

		for _, bound := range declared.Bind {
			if err := b.bind(target, bound.Exchange, bound.RoutingKey); err != nil {
				return fmt.Errorf("seed for queue %q: %w", declared.Name, err)
			}
		}
		for _, body := range declared.Messages {
			// Seeded messages arrive the way the simplest lesson publishes them:
			// on the default exchange, addressed to the queue by name.
			target.ready = append(target.ready, pending{message: mq.Message{
				RoutingKey: declared.Name,
				Body:       []byte(body),
			}})
		}
	}
	return nil
}
