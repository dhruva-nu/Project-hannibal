package amqp

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"net"
	"testing"
	"time"

	rabbit "github.com/rabbitmq/amqp091-go"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/control"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/emulator"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/mq"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/oplog"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/queues"
)

// These tests drive the codec with a real AMQP client over a real socket,
// because the only question that matters about a wire protocol is whether the
// clients that speak it are satisfied. amqp091-go is the RabbitMQ team's own
// client and is stricter about the frames it will accept than pika is, which is
// what makes it worth having as a test dependency.
//
// The listener takes an ephemeral port rather than 5672: this repository's own
// docker-compose publishes that one, and a test suite that cannot run while the
// app is up is a test suite nobody runs. verify-sandbox.sh is where a real 5672
// and a real pika meet.

func serve(t *testing.T, seed string, rules []control.Rule) (string, *oplog.Log) {
	t.Helper()

	backend := queues.New()
	if seed != "" {
		if err := backend.Seed(json.RawMessage(seed)); err != nil {
			t.Fatalf("seeding: %v", err)
		}
	}
	t.Cleanup(func() { _ = backend.Close() })

	log := oplog.New(0)
	intercept, err := control.New(rules, log)
	if err != nil {
		t.Fatalf("arming rules: %v", err)
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listening: %v", err)
	}
	t.Cleanup(func() { _ = listener.Close() })

	service := &emulator.Emulator{Proto: New(backend), Backend: backend}
	go service.Serve(listener, intercept)

	return listener.Addr().String(), log
}

func dial(t *testing.T, address string) *rabbit.Connection {
	t.Helper()

	conn, err := rabbit.Dial("amqp://guest:guest@" + address + "/")
	if err != nil {
		t.Fatalf("connecting: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	return conn
}

func open(t *testing.T, conn *rabbit.Connection) *rabbit.Channel {
	t.Helper()

	channel, err := conn.Channel()
	if err != nil {
		t.Fatalf("opening a channel: %v", err)
	}
	return channel
}

func TestAClientPublishesAndConsumesWithNoShim(t *testing.T) {
	address, log := serve(t, "", nil)
	channel := open(t, dial(t, address))

	if _, err := channel.QueueDeclare("jobs", true, false, false, false, nil); err != nil {
		t.Fatalf("declaring: %v", err)
	}
	deliveries, err := channel.Consume("jobs", "", false, false, false, false, nil)
	if err != nil {
		t.Fatalf("consuming: %v", err)
	}
	err = channel.Publish("", "jobs", false, false, rabbit.Publishing{
		ContentType: "application/json",
		Body:        []byte(`{"id": 1}`),
	})
	if err != nil {
		t.Fatalf("publishing: %v", err)
	}

	select {
	case delivery := <-deliveries:
		if string(delivery.Body) != `{"id": 1}` {
			t.Errorf("body = %q, want the published message", delivery.Body)
		}
		if delivery.ContentType != "application/json" {
			t.Errorf("content type = %q, want the property carried through", delivery.ContentType)
		}
		if err := delivery.Ack(false); err != nil {
			t.Fatalf("acking: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("nothing was delivered")
	}

	// An acknowledgement is asynchronous, so the queue is asked something
	// synchronous afterwards to be sure emu has seen it.
	state, err := channel.QueueDeclarePassive("jobs", true, false, false, false, nil)
	if err != nil {
		t.Fatalf("re-declaring: %v", err)
	}
	if state.Messages != 0 {
		t.Errorf("%d messages left, want the acknowledged one gone", state.Messages)
	}

	kinds := map[string]int{}
	for _, entry := range log.Entries() {
		kinds[entry.Op]++
	}
	if kinds["publish"] != 1 || kinds["consume"] != 1 || kinds["ack"] != 1 {
		t.Errorf("op log = %#v, want a publish, a consume, and an ack", log.Entries())
	}
}

func TestABasicGetPullsOneMessageAndSaysWhenThereIsNone(t *testing.T) {
	address, _ := serve(t, `{"queues": [{"name": "jobs", "messages": ["seeded"]}]}`, nil)
	channel := open(t, dial(t, address))

	delivery, got, err := channel.Get("jobs", false)
	if err != nil || !got || string(delivery.Body) != "seeded" {
		t.Fatalf("get = %q %v %v, want the seeded message", delivery.Body, got, err)
	}
	if err := channel.Ack(delivery.DeliveryTag, false); err != nil {
		t.Fatalf("acking: %v", err)
	}

	if _, got, err := channel.Get("jobs", true); err != nil || got {
		t.Errorf("get on an empty queue = %v %v, want Get-Empty", got, err)
	}
}

func TestTheCountsAClientIsToldAreTheOnesItActedOn(t *testing.T) {
	address, _ := serve(t, `{"queues": [{"name": "jobs", "messages": ["a", "b", "c"]}]}`, nil)
	channel := open(t, dial(t, address))

	purged, err := channel.QueuePurge("jobs", false)
	if err != nil || purged != 3 {
		t.Fatalf("purge = %d %v, want three thrown away", purged, err)
	}
	if _, err := channel.QueueDeclare("later", false, false, false, false, nil); err != nil {
		t.Fatalf("declaring: %v", err)
	}
	deleted, err := channel.QueueDelete("later", false, false, false)
	if err != nil || deleted != 0 {
		t.Errorf("delete = %d %v, want an empty queue removed", deleted, err)
	}
}

func TestAQueueTheClientDidNotNameIsNamedByEmu(t *testing.T) {
	address, _ := serve(t, "", nil)
	channel := open(t, dial(t, address))

	declared, err := channel.QueueDeclare("", false, false, true, false, nil)
	if err != nil {
		t.Fatalf("declaring: %v", err)
	}
	if declared.Name != "amq.gen-1" {
		t.Fatalf("name = %q, want emu to have named it", declared.Name)
	}
	if err := channel.Publish("", declared.Name, false, false, rabbit.Publishing{Body: []byte("x")}); err != nil {
		t.Fatalf("publishing to it: %v", err)
	}
	if _, got, _ := channel.Get(declared.Name, true); !got {
		t.Error("the queue emu named is not the queue it created")
	}
}

func TestAQueueThatIsNotThereClosesTheChannelWithTheReasonWhy(t *testing.T) {
	address, _ := serve(t, "", nil)
	channel := open(t, dial(t, address))

	_, err := channel.QueueDeclarePassive("nowhere", false, false, false, false, nil)

	var failure *rabbit.Error
	if !errors.As(err, &failure) || failure.Code != 404 {
		t.Errorf("err = %v, want a 404 the client can branch on", err)
	}
}

func TestWorkIsSharedBetweenWorkersOneMessageAtATime(t *testing.T) {
	address, _ := serve(t, `{"queues": [{"name": "jobs"}]}`, nil)
	conn := dial(t, address)
	first, second := open(t, conn), open(t, conn)
	for _, worker := range []*rabbit.Channel{first, second} {
		if err := worker.Qos(1, 0, false); err != nil {
			t.Fatalf("setting the prefetch: %v", err)
		}
	}
	toFirst, err := first.Consume("jobs", "one", false, false, false, false, nil)
	if err != nil {
		t.Fatalf("consuming: %v", err)
	}
	toSecond, err := second.Consume("jobs", "two", false, false, false, false, nil)
	if err != nil {
		t.Fatalf("consuming: %v", err)
	}

	publisher := open(t, conn)
	for _, body := range []string{"a", "b"} {
		if err := publisher.Publish("", "jobs", false, false, rabbit.Publishing{Body: []byte(body)}); err != nil {
			t.Fatalf("publishing: %v", err)
		}
	}

	for name, deliveries := range map[string]<-chan rabbit.Delivery{"one": toFirst, "two": toSecond} {
		select {
		case delivery := <-deliveries:
			if err := delivery.Ack(false); err != nil {
				t.Fatalf("acking: %v", err)
			}
		case <-time.After(5 * time.Second):
			t.Fatalf("worker %s got nothing, want the work shared", name)
		}
	}
}

func TestARefusedMessageComesBackMarkedAsARedelivery(t *testing.T) {
	address, _ := serve(t, `{"queues": [{"name": "jobs", "messages": ["retry me"]}]}`, nil)
	channel := open(t, dial(t, address))

	first, _, err := channel.Get("jobs", false)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if err := first.Nack(false, true); err != nil {
		t.Fatalf("nacking: %v", err)
	}

	second, got, err := channel.Get("jobs", false)
	if err != nil || !got || !second.Redelivered {
		t.Fatalf("second attempt = %#v %v %v, want the same message marked redelivered", second.Body, got, err)
	}
	if err := second.Reject(false); err != nil {
		t.Fatalf("rejecting: %v", err)
	}
	if _, got, _ := channel.Get("jobs", false); got {
		t.Error("a rejected message that was not requeued came back")
	}
}

func TestABatchIsAcknowledgedInOne(t *testing.T) {
	address, _ := serve(t, `{"queues": [{"name": "jobs", "messages": ["a", "b", "c"]}]}`, nil)
	channel := open(t, dial(t, address))

	var last uint64
	for range 3 {
		delivery, got, err := channel.Get("jobs", false)
		if err != nil || !got {
			t.Fatalf("get: %v %v", got, err)
		}
		last = delivery.DeliveryTag
	}
	if err := channel.Ack(last, true); err != nil {
		t.Fatalf("acking the batch: %v", err)
	}

	state, err := channel.QueueDeclarePassive("jobs", false, false, false, false, nil)
	if err != nil {
		t.Fatalf("re-declaring: %v", err)
	}
	if state.Messages != 0 {
		t.Errorf("%d messages left, want the batch settled", state.Messages)
	}
}

func TestCancellingStopsTheDeliveries(t *testing.T) {
	address, _ := serve(t, `{"queues": [{"name": "jobs"}]}`, nil)
	channel := open(t, dial(t, address))
	if _, err := channel.Consume("jobs", "worker", true, false, false, false, nil); err != nil {
		t.Fatalf("consuming: %v", err)
	}

	if err := channel.Cancel("worker", false); err != nil {
		t.Fatalf("cancelling: %v", err)
	}
	if err := channel.Publish("", "jobs", false, false, rabbit.Publishing{Body: []byte("nobody home")}); err != nil {
		t.Fatalf("publishing: %v", err)
	}

	state, err := channel.QueueDeclarePassive("jobs", false, false, false, false, nil)
	if err != nil {
		t.Fatalf("re-declaring: %v", err)
	}
	if state.Messages != 1 {
		t.Errorf("%d waiting, want the message left for a consumer that is not there", state.Messages)
	}
}

func TestClosingAChannelStopsWhatItWasConsuming(t *testing.T) {
	address, log := serve(t, `{"queues": [{"name": "jobs"}]}`, nil)
	conn := dial(t, address)
	consumer := open(t, conn)
	if _, err := consumer.Consume("jobs", "worker", true, false, false, false, nil); err != nil {
		t.Fatalf("consuming: %v", err)
	}

	if err := consumer.Close(); err != nil {
		t.Fatalf("closing the channel: %v", err)
	}

	publisher := open(t, conn)
	if err := publisher.Publish("", "jobs", false, false, rabbit.Publishing{Body: []byte("nobody home")}); err != nil {
		t.Fatalf("publishing: %v", err)
	}
	state, err := publisher.QueueDeclarePassive("jobs", false, false, false, false, nil)
	if err != nil {
		t.Fatalf("re-declaring: %v", err)
	}
	if state.Messages != 1 {
		t.Errorf("%d waiting, want the closed channel's consumer gone", state.Messages)
	}
	if !recorded(log, "cancel") {
		t.Error("the op log does not show the consumer being cancelled")
	}
}

func recorded(log *oplog.Log, kind string) bool {
	for _, entry := range log.Entries() {
		if entry.Op == kind {
			return true
		}
	}
	return false
}

func TestAConnectionThatDropsGivesBackWhatItWasHolding(t *testing.T) {
	address, _ := serve(t, `{"queues": [{"name": "jobs", "messages": ["half done"]}]}`, nil)
	worker, err := rabbit.Dial("amqp://guest:guest@" + address + "/")
	if err != nil {
		t.Fatalf("connecting: %v", err)
	}
	channel, err := worker.Channel()
	if err != nil {
		t.Fatalf("opening a channel: %v", err)
	}
	if _, _, err := channel.Get("jobs", false); err != nil {
		t.Fatalf("get: %v", err)
	}

	if err := worker.Close(); err != nil {
		t.Fatalf("closing: %v", err)
	}

	watcher := open(t, dial(t, address))
	state, err := watcher.QueueDeclarePassive("jobs", false, false, false, false, nil)
	if err != nil {
		t.Fatalf("re-declaring: %v", err)
	}
	if state.Messages != 1 {
		t.Errorf("%d waiting, want the unacknowledged message back", state.Messages)
	}
}

func TestPublisherConfirmsTellThePublisherItLanded(t *testing.T) {
	address, _ := serve(t, `{"queues": [{"name": "jobs"}]}`, nil)
	channel := open(t, dial(t, address))
	if err := channel.Confirm(false); err != nil {
		t.Fatalf("turning confirms on: %v", err)
	}
	confirms := channel.NotifyPublish(make(chan rabbit.Confirmation, 1))

	if err := channel.Publish("", "jobs", false, false, rabbit.Publishing{Body: []byte("x")}); err != nil {
		t.Fatalf("publishing: %v", err)
	}

	select {
	case confirmation := <-confirms:
		if !confirmation.Ack || confirmation.DeliveryTag != 1 {
			t.Errorf("confirmation = %#v, want the first publish acknowledged", confirmation)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("no confirmation arrived")
	}
}

func TestAnUnroutableMandatoryMessageComesBack(t *testing.T) {
	address, _ := serve(t, "", nil)
	channel := open(t, dial(t, address))
	returned := channel.NotifyReturn(make(chan rabbit.Return, 1))

	err := channel.Publish("", "nobody-declared-this", true, false, rabbit.Publishing{Body: []byte("lost")})
	if err != nil {
		t.Fatalf("publishing: %v", err)
	}

	select {
	case back := <-returned:
		if string(back.Body) != "lost" || back.ReplyCode != codeNoRoute {
			t.Errorf("returned = %#v, want the message back with NO_ROUTE", back)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("a mandatory message that routed nowhere was swallowed")
	}
}

func TestABodyTooBigForOneFrameArrivesWhole(t *testing.T) {
	address, _ := serve(t, `{"queues": [{"name": "jobs"}]}`, nil)
	channel := open(t, dial(t, address))
	big := bytes.Repeat([]byte("payload"), 40000) // comfortably over the frame maximum

	if err := channel.Publish("", "jobs", false, false, rabbit.Publishing{Body: big}); err != nil {
		t.Fatalf("publishing: %v", err)
	}

	delivery, got, err := channel.Get("jobs", true)
	if err != nil || !got {
		t.Fatalf("get = %v %v", got, err)
	}
	if !bytes.Equal(delivery.Body, big) {
		t.Errorf("came back %d bytes, want all %d", len(delivery.Body), len(big))
	}
}

func TestADepthCapRefusesThePublishThatWouldOverfillTheQueue(t *testing.T) {
	address, log := serve(t, `{"queues": [{"name": "jobs"}]}`, []control.Rule{
		{Match: "queue.publish", When: control.Conditions{"depth_gte": 100}, Action: control.ActionError,
			Message: "the queue is full"},
	})
	conn := dial(t, address)
	channel := open(t, conn)

	for published := range 101 {
		if err := channel.Publish("", "jobs", false, false, rabbit.Publishing{Body: []byte("m")}); err != nil {
			t.Fatalf("publish %d = %v, want the cap to bite only on the last one", published, err)
		}
	}

	// A publish is asynchronous, so the refusal surfaces at the next thing the
	// client waits for. That is the whole reason a lesson about a full queue
	// turns publisher confirms on.
	_, err := channel.QueueDeclarePassive("jobs", false, false, false, false, nil)
	var failure *rabbit.Error
	if !errors.As(err, &failure) || failure.Code != int(defaultFaultCode) {
		t.Fatalf("err = %v, want the channel closed with a resource error", err)
	}

	watcher := open(t, dial(t, address))
	state, err := watcher.QueueDeclarePassive("jobs", false, false, false, false, nil)
	if err != nil {
		t.Fatalf("re-declaring: %v", err)
	}
	if state.Messages != 100 {
		t.Errorf("%d messages landed, want exactly the hundred the cap allowed", state.Messages)
	}

	faulted := 0
	for _, entry := range log.Entries() {
		if entry.Fault != "" {
			faulted++
		}
	}
	if faulted != 1 {
		t.Errorf("%d operations were faulted, want only the hundred and first publish", faulted)
	}
}

func TestARefusedConnectionNeverBecomesAUsableOne(t *testing.T) {
	address, log := serve(t, "", []control.Rule{
		{Match: "queue.CONNECT", Action: control.ActionError, Message: "no room for another client"},
	})

	if _, err := rabbit.Dial("amqp://guest:guest@" + address + "/"); err == nil {
		t.Error("a connection a rule refused was handed to the client anyway")
	}

	// What the client makes of it is its own business — amqp091-go reports any
	// Close during Connection.Open as a vhost problem — so the reason itself is
	// checked on the wire.
	raw := dialRaw(t, address)
	raw.startOk()
	raw.tuneOk(proposedFrameMax, 0)
	refusal := encode(connectionOpen)
	refusal.shortstr("/")
	refusal.shortstr("")
	refusal.flags(false)
	raw.method(0, refusal)

	code, reason := raw.hungUp()
	if code != defaultFaultCode || reason != "no room for another client" {
		t.Errorf("refused with %d %q, want the rule's own reason", code, reason)
	}
	if entries := log.Entries(); len(entries) != 2 || entries[0].Op != emulator.KindConnect {
		t.Errorf("op log = %#v, want both refused connections recorded", entries)
	}
}

func TestConnectCarriesTheGaugeARuleGatesOn(t *testing.T) {
	address, _ := serve(t, "", []control.Rule{
		{Match: "queue.CONNECT", Action: control.ActionError, When: control.Conditions{"connections_gte": 1}},
	})
	dial(t, address)

	if _, err := rabbit.Dial("amqp://guest:guest@" + address + "/"); err == nil {
		t.Error("a second connection was allowed while one was already open")
	}
}

func TestADroppedConnectionLooksLikeADeadSocket(t *testing.T) {
	address, _ := serve(t, `{"queues": [{"name": "jobs"}]}`, []control.Rule{
		{Match: "queue.declare", Action: control.ActionDropConn},
	})
	conn := dial(t, address)
	channel := open(t, conn)

	if _, err := channel.QueueDeclarePassive("jobs", false, false, false, false, nil); err == nil {
		t.Fatal("the declaration succeeded on a connection that should have been dropped")
	}

	// A channel exception would have left the connection usable. This is a dead
	// socket, so the whole connection is gone.
	if !conn.IsClosed() {
		t.Error("the connection survived, want the client to see it simply stop")
	}
}

func TestAnAcknowledgementNamesTheQueueItSettles(t *testing.T) {
	address, log := serve(t, `{"queues": [{"name": "jobs", "messages": ["one"]}]}`, nil)
	channel := open(t, dial(t, address))

	delivery, _, err := channel.Get("jobs", false)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if err := channel.Ack(delivery.DeliveryTag, false); err != nil {
		t.Fatalf("acking: %v", err)
	}
	if _, err := channel.QueueDeclarePassive("jobs", false, false, false, false, nil); err != nil {
		t.Fatalf("re-declaring: %v", err)
	}

	for _, entry := range log.Entries() {
		if entry.Op == "ack" && entry.Target != "jobs" {
			t.Errorf("the acknowledgement was logged against %q, want the queue it came from", entry.Target)
		}
	}
}

func TestAnExchangeAndItsBindingsAreWhatTheClientDeclared(t *testing.T) {
	address, _ := serve(t, "", nil)
	channel := open(t, dial(t, address))

	if err := channel.ExchangeDeclare("events", "fanout", false, false, false, false, nil); err != nil {
		t.Fatalf("declaring the exchange: %v", err)
	}
	for _, name := range []string{"audit", "billing"} {
		if _, err := channel.QueueDeclare(name, false, false, false, false, nil); err != nil {
			t.Fatalf("declaring %s: %v", name, err)
		}
		if err := channel.QueueBind(name, "", "events", false, nil); err != nil {
			t.Fatalf("binding %s: %v", name, err)
		}
	}

	if err := channel.Publish("events", "ignored", false, false, rabbit.Publishing{Body: []byte("x")}); err != nil {
		t.Fatalf("publishing: %v", err)
	}

	for _, name := range []string{"audit", "billing"} {
		state, err := channel.QueueDeclarePassive(name, false, false, false, false, nil)
		if err != nil {
			t.Fatalf("re-declaring %s: %v", name, err)
		}
		if state.Messages != 1 {
			t.Errorf("%s holds %d, want the fanout to have reached it", name, state.Messages)
		}
	}
}

func TestASessionEndsWhenItCannotWriteToTheClient(t *testing.T) {
	client, server := net.Pipe()
	_ = client.Close()
	t.Cleanup(func() { _ = server.Close() })

	live := newSession(New(queues.New()), bufio.NewReader(server), bufio.NewWriter(server),
		tuning{frameMax: proposedFrameMax}, 0)
	t.Cleanup(func() { _ = live.Close() })

	if _, err := live.Next(); err != nil {
		t.Fatalf("the first operation is the connection itself: %v", err)
	}
	// A channel the client opened before the socket went away, and a delivery
	// the backend has decided belongs to it.
	live.channels[1] = &channel{consumers: map[string]string{}}
	live.deliveries.Deliver(mq.Delivery{Channel: 1, Queue: "jobs"})

	if _, err := live.Next(); err == nil {
		t.Error("Next carried on against a connection it cannot write to")
	}
}

func TestTheReaderStopsWhenTheSessionDoes(t *testing.T) {
	client, server := net.Pipe()
	t.Cleanup(func() { _ = client.Close(); _ = server.Close() })

	live := newSession(New(queues.New()), bufio.NewReader(server), bufio.NewWriter(server),
		tuning{frameMax: proposedFrameMax}, 0)

	// Nobody is calling Next, so the reader parks holding a frame it cannot hand
	// over. Closing the session has to be enough to release it.
	go func() {
		beat := encodeFrame(frame{kind: frameHeartbeat})
		for {
			if _, err := client.Write(beat); err != nil {
				return
			}
		}
	}()
	time.Sleep(50 * time.Millisecond)
	_ = live.Close()

	deadline := time.After(5 * time.Second)
	for {
		select {
		case _, alive := <-live.frames:
			if !alive {
				return
			}
		case <-deadline:
			t.Fatal("the reader goroutine is still parked on a session that has gone")
		}
	}
}
