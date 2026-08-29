// Package queues holds the messages the emulated broker is asked to keep.
//
// The control layer mocks *behaviour* — this publish is refused, this delivery
// is late. Something still has to answer *semantics*: which queues a topic
// binding reaches, which consumer gets the next message, what an unacknowledged
// delivery does when its consumer disappears. A student whose round-robin
// worker pool silently received every message twice has no feedback loop left,
// so those answers are computed rather than canned.
//
// Everything lives in memory and dies with the run. There is no persistence to
// emulate: a lesson that wants a queue to survive a restart is a lesson about
// something emu does not have.
package queues

import (
	"fmt"
	"sync"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/emulator"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/mq"
)

// generatedQueuePrefix is what AMQP calls a server-named queue. The number is a
// counter rather than anything random, so two runs of the same lesson produce
// the same names and the same op log.
const generatedQueuePrefix = "amq.gen-"

// A Backend is one emulated broker: its queues, its exchanges, and the
// deliveries its connections have not settled yet.
//
// One mutex guards all of it. The critical sections are a few map lookups and a
// slice append, and a publish on one connection has to reach into the delivery
// bookkeeping of another — so a lock per queue would buy contention it does not
// have in exchange for an ordering rule it would be easy to get wrong.
type Backend struct {
	mutex     sync.Mutex
	queues    map[string]*queue
	exchanges map[string]*exchange
	generated int
}

// A queue is messages waiting, messages handed out and not yet settled, and the
// consumers taking turns at them.
type queue struct {
	name      string
	ready     []pending
	unacked   int
	consumers []*consumer
	// turn is where the round robin left off, which is what makes two workers on
	// one queue split the work instead of one of them taking all of it.
	turn int
}

// a pending message is one waiting in a queue. It remembers whether it has been
// out before, because a consumer that gets a message a second time is entitled
// to know — a lesson about retries is about nothing else.
type pending struct {
	message     mq.Message
	redelivered bool
}

// A consumer is one Basic.Consume: a tag, the connection that owns it, and the
// sink that connection's session writes deliveries out of.
type consumer struct {
	tag     string
	queue   *queue
	owner   *connection
	sink    mq.Sink
	channel uint16
	noAck   bool
}

func New() *Backend {
	return &Backend{queues: map[string]*queue{}, exchanges: map[string]*exchange{}}
}

// Open gives one client connection its own delivery bookkeeping, because a
// delivery tag means nothing outside the connection it was issued on and an
// unacknowledged message belongs to the connection that was handed it.
func (b *Backend) Open() (emulator.Executor, error) {
	return &connection{
		backend:     b,
		held:        map[uint64]*held{},
		outstanding: map[uint16]int{},
		prefetch:    map[uint16]int{},
		consumers:   map[string]*consumer{},
	}, nil
}

// Close drops every queue and everything in them.
func (b *Backend) Close() error {
	b.mutex.Lock()
	defer b.mutex.Unlock()

	b.queues, b.exchanges = map[string]*queue{}, map[string]*exchange{}
	return nil
}

// Gauges is what a rule's `when` clause reads about the queues an operation is
// aimed at, *before* it runs — which is the only moment at which the answer can
// change what happens to it.
//
// The arguments are an exchange and a routing key because that is what a
// publish is addressed with; a queue-scoped operation passes the default
// exchange and its queue's name, which under that exchange are the same thing.
// A publish that fans out to several queues reports the fullest of them, since
// a depth cap is asking whether any destination is full.
func (b *Backend) Gauges(exchange, routingKey string) map[string]int {
	b.mutex.Lock()
	defer b.mutex.Unlock()

	return b.gaugesFor(exchange, routingKey)
}

// gaugesFor is the same answer for a caller that already holds the mutex.
func (b *Backend) gaugesFor(exchange, routingKey string) map[string]int {
	var fullest *queue
	for _, reached := range b.destinations(exchange, routingKey) {
		if fullest == nil || len(reached.ready) > len(fullest.ready) {
			fullest = reached
		}
	}
	return gaugesOf(fullest)
}

// gaugesOf reports zeros for an operation that names no queue, so that every op
// carries the same gauges and a rule gated on a depth can never fire on one
// that has none.
func gaugesOf(target *queue) map[string]int {
	if target == nil {
		return map[string]int{mq.GaugeDepth: 0, mq.GaugeUnacked: 0, mq.GaugeConsumers: 0}
	}
	return map[string]int{
		mq.GaugeDepth:     len(target.ready),
		mq.GaugeUnacked:   target.unacked,
		mq.GaugeConsumers: len(target.consumers),
	}
}

// declare creates a queue if it is not there, or with passive only asserts that
// it is. A redeclaration is deliberately not checked against the flags of the
// first one: durability and exclusivity mean nothing in a broker that dies with
// the run, so refusing a mismatch would fail lessons over a difference emu does
// not implement either way.
func (b *Backend) declare(name string, request mq.Declare) (*queue, error) {
	if request.Passive {
		existing, declared := b.queues[name]
		if !declared {
			return nil, noQueue(name)
		}
		return existing, nil
	}
	if name == "" {
		b.generated++
		name = fmt.Sprintf("%s%d", generatedQueuePrefix, b.generated)
	}
	if existing, declared := b.queues[name]; declared {
		return existing, nil
	}
	created := &queue{name: name}
	b.queues[name] = created
	return created, nil
}

// remove deletes a queue and everything pointing at it: its bindings, so an
// exchange does not route into a queue nobody can read, and its consumers, so
// the connections that had them stop being told about it.
func (b *Backend) remove(target *queue) int {
	removed := len(target.ready)
	delete(b.queues, target.name)

	for _, routed := range b.exchanges {
		routed.unbindAll(target)
	}
	for _, taking := range target.consumers {
		delete(taking.owner.consumers, taking.tag)
	}
	target.ready, target.consumers = nil, nil
	return removed
}

// publish puts a message into every queue the exchange routes it to and then
// hands out whatever the consumers there have room for.
func (b *Backend) publish(message mq.Message) (int, error) {
	if !b.hasExchange(message.Exchange) {
		return 0, noExchange(message.Exchange)
	}
	reached := b.destinations(message.Exchange, message.RoutingKey)
	for _, target := range reached {
		target.ready = append(target.ready, pending{message: message})
		b.dispatch(target)
	}
	return len(reached), nil
}

// dispatch hands messages to consumers until the queue runs out or every
// consumer is holding as much as its channel's prefetch allows.
func (b *Backend) dispatch(target *queue) {
	for len(target.ready) > 0 {
		taking := target.next()
		if taking == nil {
			return
		}
		waiting := target.ready[0]
		target.ready = target.ready[1:]
		taking.owner.push(taking, waiting)
	}
}

// next is the round robin, skipping consumers whose channel is already holding
// its prefetch. It reports nil when none of them can take another message.
func (q *queue) next() *consumer {
	for range q.consumers {
		candidate := q.consumers[q.turn%len(q.consumers)]
		q.turn = (q.turn + 1) % len(q.consumers)
		if candidate.owner.hasRoom(candidate.channel) {
			return candidate
		}
	}
	return nil
}

// requeue puts a refused message back at the head of its queue, where AMQP says
// it should go: a worker that nacked because it could not cope must not have
// reordered the queue for the worker that can.
func (q *queue) requeue(message mq.Message) {
	q.ready = append([]pending{{message: message, redelivered: true}}, q.ready...)
}

func (q *queue) dropConsumer(tag string) {
	for index, taking := range q.consumers {
		if taking.tag == tag {
			q.consumers = append(q.consumers[:index], q.consumers[index+1:]...)
			q.turn = 0
			return
		}
	}
}
