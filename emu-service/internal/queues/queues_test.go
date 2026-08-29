package queues

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/control"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/emulator"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/mq"
)

// a sink collects what the backend decided to push, standing in for the session
// that would write it to a socket.
type sink struct{ pushed []mq.Delivery }

func (s *sink) Deliver(delivery mq.Delivery) { s.pushed = append(s.pushed, delivery) }

func (s *sink) bodies() []string {
	var seen []string
	for _, delivery := range s.pushed {
		seen = append(seen, string(delivery.Message.Body))
	}
	return seen
}

func open(t *testing.T, backend *Backend) emulator.Executor {
	t.Helper()

	executor, err := backend.Open()
	if err != nil {
		t.Fatalf("opening a connection: %v", err)
	}
	t.Cleanup(func() { _ = executor.Close() })
	return executor
}

func run(t *testing.T, executor emulator.Executor, op control.Op) emulator.Result {
	t.Helper()

	result, err := executor.Exec(op)
	if err != nil {
		t.Fatalf("%s %q: %v", op.Kind, op.Target, err)
	}
	return result
}

func refused(t *testing.T, executor emulator.Executor, op control.Op, want uint16) {
	t.Helper()

	_, err := executor.Exec(op)
	var coded *queueError
	if !errors.As(err, &coded) || coded.ReplyCode() != want {
		t.Fatalf("%s %q = %v, want reply code %d", op.Kind, op.Target, err, want)
	}
}

func declare(name string) control.Op {
	return control.Op{Kind: mq.KindDeclare, Target: name, Payload: mq.Declare{}}
}

func publish(exchange, routingKey, body string) control.Op {
	return control.Op{
		Kind:   mq.KindPublish,
		Target: routingKey,
		Payload: mq.Publish{Message: mq.Message{
			Exchange: exchange, RoutingKey: routingKey, Body: []byte(body),
		}},
	}
}

func get(name string) control.Op {
	return control.Op{Kind: mq.KindGet, Target: name, Payload: mq.Get{Channel: 1}}
}

func consume(name, tag string, into mq.Sink) control.Op {
	return control.Op{
		Kind:    mq.KindConsume,
		Target:  name,
		Payload: mq.Consume{Tag: tag, Sink: into, Channel: 1},
	}
}

func TestAMessageGoesInAndComesOut(t *testing.T) {
	backend := New()
	client := open(t, backend)

	run(t, client, declare("jobs"))
	run(t, client, publish("", "jobs", "first"))
	result := run(t, client, get("jobs"))

	delivery, found := mq.Fetch(result)
	if !found || string(delivery.Message.Body) != "first" {
		t.Fatalf("get = %#v, want the published message", result)
	}
	if delivery.Redelivered {
		t.Error("a message nobody has seen before came back marked as a redelivery")
	}
}

func TestAnEmptyQueueIsAnsweredRatherThanRefused(t *testing.T) {
	backend := New()
	client := open(t, backend)
	run(t, client, declare("jobs"))

	if _, found := mq.Fetch(run(t, client, get("jobs"))); found {
		t.Error("an empty queue produced a message")
	}
}

func TestAPublishToNowhereIsNotAFailure(t *testing.T) {
	backend := New()
	client := open(t, backend)

	result := run(t, client, publish("", "nobody-declared-this", "lost"))

	if result.Gauges[mq.GaugeRouted] != 0 {
		t.Errorf("routed to %d queues, want none — a client learns this from `mandatory`, not an error", result.Gauges[mq.GaugeRouted])
	}
}

func TestAPublishToAnExchangeThatIsNotThereIsRefused(t *testing.T) {
	backend := New()
	client := open(t, backend)

	refused(t, client, publish("nowhere", "key", "lost"), codeNotFound)
}

func TestEveryOperationOnAQueueThatIsNotThereNamesIt(t *testing.T) {
	backend := New()
	client := open(t, backend)

	for _, op := range []control.Op{
		get("missing"),
		consume("missing", "tag", &sink{}),
		{Kind: mq.KindBind, Target: "missing", Payload: mq.Bind{Exchange: "events"}},
		{Kind: mq.KindPurge, Target: "missing"},
		{Kind: mq.KindDelete, Target: "missing"},
		{Kind: mq.KindDeclare, Target: "missing", Payload: mq.Declare{Passive: true}},
	} {
		refused(t, client, op, codeNotFound)
	}
}

func TestAServerNamedQueueIsCountedRatherThanRandom(t *testing.T) {
	backend := New()
	client := open(t, backend)

	first := run(t, client, declare(""))
	second := run(t, client, declare(""))

	if first.Tag != "amq.gen-1" || second.Tag != "amq.gen-2" {
		t.Errorf("generated %q and %q, want names two runs of a lesson would agree on", first.Tag, second.Tag)
	}
}

func TestDeclaringAQueueTwiceIsTheSameQueue(t *testing.T) {
	backend := New()
	client := open(t, backend)

	run(t, client, declare("jobs"))
	run(t, client, publish("", "jobs", "kept"))
	again := run(t, client, declare("jobs"))

	if again.Gauges[mq.GaugeDepth] != 1 {
		t.Errorf("depth = %d, want the redeclaration to have left the message alone", again.Gauges[mq.GaugeDepth])
	}
}

func TestAnExchangeRoutesTheWayItsKindSays(t *testing.T) {
	for name, expectation := range map[string]struct {
		kind      string
		bindings  []string
		routedTo  []string
		published string
	}{
		"direct matches the binding exactly": {
			kind: kindDirect, bindings: []string{"order.created", "order.paid"},
			published: "order.paid", routedTo: []string{"q1"},
		},
		"fanout ignores the key": {
			kind: kindFanout, bindings: []string{"ignored", "also-ignored"},
			published: "anything", routedTo: []string{"q0", "q1"},
		},
		"a topic word wildcard": {
			kind: kindTopic, bindings: []string{"order.*", "order.*.late"},
			published: "order.created", routedTo: []string{"q0"},
		},
		"a topic multi-word wildcard": {
			kind: kindTopic, bindings: []string{"order.#", "#"},
			published: "order.eu.created", routedTo: []string{"q0", "q1"},
		},
	} {
		t.Run(name, func(t *testing.T) {
			backend := New()
			client := open(t, backend)
			run(t, client, control.Op{Kind: mq.KindExchange, Target: "events", Payload: mq.Exchange{Kind: expectation.kind}})

			for index, key := range expectation.bindings {
				queueName := "q" + string(rune('0'+index))
				run(t, client, declare(queueName))
				run(t, client, control.Op{
					Kind: mq.KindBind, Target: queueName,
					Payload: mq.Bind{Exchange: "events", RoutingKey: key},
				})
			}
			run(t, client, publish("events", expectation.published, "routed"))

			for index := range expectation.bindings {
				queueName := "q" + string(rune('0'+index))
				depth := run(t, client, declare(queueName)).Gauges[mq.GaugeDepth]
				wanted := 0
				if contains(expectation.routedTo, queueName) {
					wanted = 1
				}
				if depth != wanted {
					t.Errorf("%s holds %d, want %d", queueName, depth, wanted)
				}
			}
		})
	}
}

func contains(names []string, wanted string) bool {
	for _, name := range names {
		if name == wanted {
			return true
		}
	}
	return false
}

func TestAQueueBoundTwiceStillReceivesAMessageOnce(t *testing.T) {
	backend := New()
	client := open(t, backend)
	run(t, client, control.Op{Kind: mq.KindExchange, Target: "events", Payload: mq.Exchange{Kind: kindTopic}})
	run(t, client, declare("all"))
	for _, key := range []string{"order.#", "#"} {
		run(t, client, control.Op{Kind: mq.KindBind, Target: "all", Payload: mq.Bind{Exchange: "events", RoutingKey: key}})
	}

	run(t, client, publish("events", "order.created", "once"))

	if depth := run(t, client, declare("all")).Gauges[mq.GaugeDepth]; depth != 1 {
		t.Errorf("depth = %d, want one copy however many bindings matched", depth)
	}
}

func TestTheExchangesAClientMayNotHaveAreRefusedWithAReason(t *testing.T) {
	backend := New()
	client := open(t, backend)
	run(t, client, declare("jobs"))
	run(t, client, control.Op{Kind: mq.KindExchange, Target: "events", Payload: mq.Exchange{Kind: kindFanout}})

	for name, expectation := range map[string]struct {
		op   control.Op
		code uint16
	}{
		"declaring the default exchange": {
			control.Op{Kind: mq.KindExchange, Target: "", Payload: mq.Exchange{Kind: kindDirect}}, codeAccessRefused,
		},
		"binding to the default exchange": {
			control.Op{Kind: mq.KindBind, Target: "jobs", Payload: mq.Bind{Exchange: ""}}, codeAccessRefused,
		},
		"binding to an exchange that is not there": {
			control.Op{Kind: mq.KindBind, Target: "jobs", Payload: mq.Bind{Exchange: "nowhere"}}, codeNotFound,
		},
		"a kind emu does not route": {
			control.Op{Kind: mq.KindExchange, Target: "matched", Payload: mq.Exchange{Kind: "headers"}}, codeCommandInvalid,
		},
		"redeclaring one as another kind": {
			control.Op{Kind: mq.KindExchange, Target: "events", Payload: mq.Exchange{Kind: kindDirect}}, codePreconditionFailed,
		},
		"asserting one that is not there": {
			control.Op{Kind: mq.KindExchange, Target: "nowhere", Payload: mq.Exchange{Passive: true}}, codeNotFound,
		},
	} {
		t.Run(name, func(t *testing.T) { refused(t, client, expectation.op, expectation.code) })
	}
}

func TestRedeclaringAnExchangeTheSameWayIsAllowed(t *testing.T) {
	backend := New()
	client := open(t, backend)
	same := control.Op{Kind: mq.KindExchange, Target: "events", Payload: mq.Exchange{Kind: kindFanout}}

	run(t, client, same)
	run(t, client, same)
	run(t, client, control.Op{Kind: mq.KindExchange, Target: "events", Payload: mq.Exchange{Passive: true}})
}

func TestPurgeThrowsAwayWhatIsWaitingAndNothingElse(t *testing.T) {
	backend := New()
	client := open(t, backend)
	run(t, client, declare("jobs"))
	for _, body := range []string{"a", "b", "c"} {
		run(t, client, publish("", "jobs", body))
	}
	// One message is out with a consumer, so it is not the queue's to discard.
	run(t, client, get("jobs"))

	purged := run(t, client, control.Op{Kind: mq.KindPurge, Target: "jobs"})

	if purged.Gauges[mq.GaugeRemoved] != 2 || purged.Gauges[mq.GaugeUnacked] != 1 {
		t.Errorf("purge = %#v, want two removed and the unacknowledged one left", purged.Gauges)
	}
}

func TestDeletingAQueueTakesItsBindingsAndConsumersWithIt(t *testing.T) {
	backend := New()
	client := open(t, backend)
	into := &sink{}
	run(t, client, control.Op{Kind: mq.KindExchange, Target: "events", Payload: mq.Exchange{Kind: kindFanout}})
	run(t, client, declare("jobs"))
	run(t, client, control.Op{Kind: mq.KindBind, Target: "jobs", Payload: mq.Bind{Exchange: "events"}})
	run(t, client, consume("jobs", "worker", into))
	run(t, client, publish("", "jobs", "a"))

	deleted := run(t, client, control.Op{Kind: mq.KindDelete, Target: "jobs"})

	if deleted.Gauges[mq.GaugeRemoved] != 0 {
		t.Errorf("removed %d, want none: the message had already gone to the consumer", deleted.Gauges[mq.GaugeRemoved])
	}
	if routed := run(t, client, publish("events", "anything", "b")); routed.Gauges[mq.GaugeRouted] != 0 {
		t.Error("the exchange still routes into a queue that was deleted")
	}
	refused(t, client, control.Op{Kind: mq.KindDelete, Target: "jobs"}, codeNotFound)
}

func TestTwoConsumersOnOneQueueTakeTurns(t *testing.T) {
	backend := New()
	client := open(t, backend)
	first, second := &sink{}, &sink{}
	run(t, client, declare("jobs"))
	run(t, client, consume("jobs", "one", first))
	run(t, client, consume("jobs", "two", second))

	for _, body := range []string{"a", "b", "c", "d"} {
		run(t, client, publish("", "jobs", body))
	}

	if len(first.pushed) != 2 || len(second.pushed) != 2 {
		t.Errorf("split %v and %v, want the work shared", first.bodies(), second.bodies())
	}
}

func TestAPrefetchStopsAConsumerTakingMoreThanItCanFinish(t *testing.T) {
	backend := New()
	client := open(t, backend)
	into := &sink{}
	run(t, client, declare("jobs"))
	run(t, client, control.Op{Kind: mq.KindQos, Payload: mq.Qos{Channel: 1, Prefetch: 1}})
	run(t, client, consume("jobs", "worker", into))

	run(t, client, publish("", "jobs", "a"))
	run(t, client, publish("", "jobs", "b"))
	if len(into.pushed) != 1 {
		t.Fatalf("delivered %v while one was unacknowledged, want just the first", into.bodies())
	}

	run(t, client, control.Op{Kind: mq.KindAck, Payload: mq.Ack{Tag: into.pushed[0].Tag, Channel: 1}})

	if len(into.pushed) != 2 {
		t.Errorf("delivered %v after the acknowledgement, want the second to follow", into.bodies())
	}
}

func TestRaisingThePrefetchReleasesWhatWasWaiting(t *testing.T) {
	backend := New()
	client := open(t, backend)
	into := &sink{}
	run(t, client, declare("jobs"))
	run(t, client, control.Op{Kind: mq.KindQos, Payload: mq.Qos{Channel: 1, Prefetch: 1}})
	run(t, client, consume("jobs", "worker", into))
	run(t, client, publish("", "jobs", "a"))
	run(t, client, publish("", "jobs", "b"))

	run(t, client, control.Op{Kind: mq.KindQos, Payload: mq.Qos{Channel: 1, Prefetch: 5}})

	if len(into.pushed) != 2 {
		t.Errorf("delivered %v, want the raised prefetch to have released the second", into.bodies())
	}
}

func TestARequeuedMessageComesBackMarkedAsOne(t *testing.T) {
	backend := New()
	client := open(t, backend)
	run(t, client, declare("jobs"))
	run(t, client, publish("", "jobs", "retry me"))
	first, _ := mq.Fetch(run(t, client, get("jobs")))

	run(t, client, control.Op{Kind: mq.KindNack, Payload: mq.Nack{Tag: first.Tag, Channel: 1, Requeue: true}})
	second, found := mq.Fetch(run(t, client, get("jobs")))

	if !found || !second.Redelivered {
		t.Errorf("second attempt = %#v, want the same message marked as a redelivery", second)
	}
}

func TestARejectedMessageThatIsNotRequeuedIsGone(t *testing.T) {
	backend := New()
	client := open(t, backend)
	run(t, client, declare("jobs"))
	run(t, client, publish("", "jobs", "drop me"))
	delivery, _ := mq.Fetch(run(t, client, get("jobs")))

	run(t, client, control.Op{Kind: mq.KindNack, Payload: mq.Nack{Tag: delivery.Tag, Channel: 1}})

	if _, found := mq.Fetch(run(t, client, get("jobs"))); found {
		t.Error("a message nobody requeued came back")
	}
}

func TestAcknowledgingSeveralAtOnceSettlesTheWholeBatch(t *testing.T) {
	backend := New()
	client := open(t, backend)
	into := &sink{}
	run(t, client, declare("jobs"))
	run(t, client, consume("jobs", "worker", into))
	for _, body := range []string{"a", "b", "c"} {
		run(t, client, publish("", "jobs", body))
	}

	settled := run(t, client, control.Op{Kind: mq.KindAck, Payload: mq.Ack{Channel: 1, Multiple: true}})

	if settled.Gauges[mq.GaugeUnacked] != 0 {
		t.Errorf("%d still unacknowledged, want delivery tag zero to have settled all of them", settled.Gauges[mq.GaugeUnacked])
	}
}

func TestRequeueingABatchPutsItBackInOrder(t *testing.T) {
	backend := New()
	client := open(t, backend)
	into := &sink{}
	run(t, client, declare("jobs"))
	run(t, client, consume("jobs", "worker", into))
	for _, body := range []string{"a", "b", "c"} {
		run(t, client, publish("", "jobs", body))
	}
	run(t, client, control.Op{Kind: mq.KindCancel, Payload: mq.Cancel{Tag: "worker"}})

	run(t, client, control.Op{Kind: mq.KindNack, Payload: mq.Nack{Channel: 1, Multiple: true, Requeue: true}})

	var order []string
	for range 3 {
		delivery, _ := mq.Fetch(run(t, client, get("jobs")))
		order = append(order, string(delivery.Message.Body))
	}
	if strings.Join(order, "") != "abc" {
		t.Errorf("came back as %v, want the order they went out in", order)
	}
}

func TestSettlingADeliveryThatWasNeverMadeIsRefused(t *testing.T) {
	backend := New()
	client := open(t, backend)

	refused(t, client, control.Op{Kind: mq.KindAck, Payload: mq.Ack{Tag: 7, Channel: 1}}, codePreconditionFailed)
}

func TestTwoConsumersCannotShareATagOnOneConnection(t *testing.T) {
	backend := New()
	client := open(t, backend)
	run(t, client, declare("jobs"))
	run(t, client, consume("jobs", "worker", &sink{}))

	refused(t, client, consume("jobs", "worker", &sink{}), codeNotAllowed)
}

func TestAConsumerTheClientDidNotNameGetsOne(t *testing.T) {
	backend := New()
	client := open(t, backend)
	run(t, client, declare("jobs"))

	if tag := run(t, client, consume("jobs", "", &sink{})).Tag; tag != "amq.ctag-1" {
		t.Errorf("consumer tag = %q, want one two runs of a lesson would agree on", tag)
	}
}

func TestCancellingAConsumerStopsItAndCancellingNothingSaysSo(t *testing.T) {
	backend := New()
	client := open(t, backend)
	into := &sink{}
	run(t, client, declare("jobs"))
	run(t, client, consume("jobs", "worker", into))

	run(t, client, control.Op{Kind: mq.KindCancel, Target: "jobs", Payload: mq.Cancel{Tag: "worker"}})
	run(t, client, publish("", "jobs", "nobody is listening"))

	if len(into.pushed) != 0 {
		t.Errorf("a cancelled consumer was still delivered %v", into.bodies())
	}
	refused(t, client, control.Op{Kind: mq.KindCancel, Payload: mq.Cancel{Tag: "worker"}}, codeNotFound)
}

func TestANoAckConsumerIsNeverOwedAnAcknowledgement(t *testing.T) {
	backend := New()
	client := open(t, backend)
	into := &sink{}
	run(t, client, declare("jobs"))
	run(t, client, control.Op{
		Kind: mq.KindConsume, Target: "jobs",
		Payload: mq.Consume{Tag: "worker", Sink: into, Channel: 1, NoAck: true},
	})

	result := run(t, client, publish("", "jobs", "fire and forget"))

	if result.Gauges[mq.GaugeUnacked] != 0 || !into.pushed[0].NoAck {
		t.Errorf("gauges = %#v, delivery = %#v, want nothing outstanding", result.Gauges, into.pushed[0])
	}
}

func TestAConnectionThatEndsGivesBackWhatItWasHolding(t *testing.T) {
	backend := New()
	t.Cleanup(func() { _ = backend.Close() })
	holder, err := backend.Open()
	if err != nil {
		t.Fatalf("opening: %v", err)
	}
	watcher := open(t, backend)

	run(t, watcher, declare("jobs"))
	run(t, holder, consume("jobs", "worker", &sink{}))
	run(t, watcher, publish("", "jobs", "half done"))
	if depth := run(t, watcher, declare("jobs")).Gauges[mq.GaugeDepth]; depth != 0 {
		t.Fatalf("depth = %d, want the message out with the consumer", depth)
	}

	if err := holder.Close(); err != nil {
		t.Fatalf("closing: %v", err)
	}

	back := run(t, watcher, declare("jobs")).Gauges
	if back[mq.GaugeDepth] != 1 || back[mq.GaugeConsumers] != 0 {
		t.Errorf("gauges = %#v, want the message back in the queue and the consumer gone", back)
	}
}

func TestGaugesDescribeTheFullestQueueAPublishWouldReach(t *testing.T) {
	backend := New()
	client := open(t, backend)
	run(t, client, control.Op{Kind: mq.KindExchange, Target: "events", Payload: mq.Exchange{Kind: kindFanout}})
	for _, name := range []string{"small", "large"} {
		run(t, client, declare(name))
		run(t, client, control.Op{Kind: mq.KindBind, Target: name, Payload: mq.Bind{Exchange: "events"}})
	}
	for range 3 {
		run(t, client, publish("", "large", "filler"))
	}

	if depth := backend.Gauges("events", "anything")[mq.GaugeDepth]; depth != 3 {
		t.Errorf("depth = %d, want the fullest destination — a cap asks whether any of them is full", depth)
	}
	if depth := backend.Gauges("", "not-a-queue")[mq.GaugeDepth]; depth != 0 {
		t.Errorf("depth = %d, want zeros for an operation that names no queue", depth)
	}
	if depth := backend.Gauges("no-such-exchange", "key")[mq.GaugeDepth]; depth != 0 {
		t.Errorf("depth = %d, want zeros when nothing is reachable", depth)
	}
}

func TestAnOperationTheBackendHasNoAnswerForSaysSo(t *testing.T) {
	backend := New()
	client := open(t, backend)

	_, err := client.Exec(control.Op{Kind: "levitate"})

	if err == nil || !strings.Contains(err.Error(), "levitate") {
		t.Errorf("err = %v, want the operation named", err)
	}
}

func TestConnectAndAbortDoNothing(t *testing.T) {
	backend := New()
	client := open(t, backend)
	run(t, client, declare("jobs"))
	run(t, client, publish("", "jobs", "still here"))

	run(t, client, control.Op{Kind: emulator.KindConnect})
	client.Abort(control.Op{Kind: mq.KindPublish})

	if depth := run(t, client, declare("jobs")).Gauges[mq.GaugeDepth]; depth != 1 {
		t.Errorf("depth = %d, want the message untouched", depth)
	}
}

func TestClosingTheBackendDropsEverything(t *testing.T) {
	backend := New()
	client := open(t, backend)
	run(t, client, declare("jobs"))

	if err := backend.Close(); err != nil {
		t.Fatalf("Close = %v", err)
	}

	refused(t, client, get("jobs"), codeNotFound)
}

func TestTheSeedIsTheBrokerAStudentFindsAlreadyRunning(t *testing.T) {
	backend := New()
	err := backend.Seed(json.RawMessage(`{
		"exchanges": [{"name": "events", "type": "topic"}],
		"queues": [
			{"name": "orders",
			 "bind": [{"exchange": "events", "routing_key": "order.*"}],
			 "messages": ["one", "two"]}
		]
	}`))
	if err != nil {
		t.Fatalf("Seed = %v", err)
	}
	client := open(t, backend)

	if depth := run(t, client, declare("orders")).Gauges[mq.GaugeDepth]; depth != 2 {
		t.Errorf("depth = %d, want the seeded messages waiting", depth)
	}
	run(t, client, publish("events", "order.created", "routed"))
	if depth := run(t, client, declare("orders")).Gauges[mq.GaugeDepth]; depth != 3 {
		t.Error("the seeded binding does not route")
	}
	delivery, _ := mq.Fetch(run(t, client, get("orders")))
	if string(delivery.Message.Body) != "one" || delivery.Message.RoutingKey != "orders" {
		t.Errorf("first message = %#v, want it seeded on the default exchange", delivery.Message)
	}
}

func TestAnEmptySeedIsNothingToDo(t *testing.T) {
	backend := New()

	if err := backend.Seed(nil); err != nil {
		t.Errorf("Seed(nil) = %v", err)
	}
}

func TestASeedThatCannotBeBuiltFailsTheRun(t *testing.T) {
	for name, seed := range map[string]string{
		"a field the loader does not know":  `{"queues": [], "quues": []}`,
		"not an object at all":              `["jobs"]`,
		"an exchange kind emu cannot route": `{"exchanges": [{"name": "e", "type": "headers"}]}`,
		"a queue with no name":              `{"queues": [{"name": ""}]}`,
		"a binding to an exchange the seed never declared": `{
			"queues": [{"name": "orders", "bind": [{"exchange": "nowhere", "routing_key": "k"}]}]
		}`,
	} {
		t.Run(name, func(t *testing.T) {
			if err := New().Seed(json.RawMessage(seed)); err == nil {
				t.Error("Seed accepted a topology it cannot build")
			} else if !strings.Contains(err.Error(), "seed for queue") {
				t.Errorf("Seed = %v, want the seed blamed", err)
			}
		})
	}
}

func TestAPassiveDeclarationOfAQueueThatExistsIsAnAssertion(t *testing.T) {
	backend := New()
	client := open(t, backend)
	run(t, client, declare("jobs"))
	run(t, client, publish("", "jobs", "kept"))

	asserted := run(t, client, control.Op{
		Kind: mq.KindDeclare, Target: "jobs", Payload: mq.Declare{Passive: true},
	})

	if asserted.Tag != "jobs" || asserted.Gauges[mq.GaugeDepth] != 1 {
		t.Errorf("passive declare = %#v, want the queue reported as it is", asserted)
	}
}

func TestATopicPatternMatchesTheWayTheSpecificationSays(t *testing.T) {
	for _, expectation := range []struct {
		pattern, routingKey string
		matches             bool
	}{
		{"order.created", "order.created", true},
		{"order.created", "order.paid", false},
		{"order.*", "order.paid", true},
		{"order.*", "order.eu.paid", false},
		{"order.*", "order", false},
		{"order.#", "order", true},
		{"order.#", "order.eu.paid", true},
		{"order.#", "invoice.paid", false},
		{"#", "anything.at.all", true},
		{"#.paid", "order.eu.paid", true},
		{"#.paid", "order.eu.sent", false},
	} {
		if got := topicMatches(expectation.pattern, expectation.routingKey); got != expectation.matches {
			t.Errorf("%q against %q = %v, want %v", expectation.pattern, expectation.routingKey, got, expectation.matches)
		}
	}
}
