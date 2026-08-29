package resp

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/control"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/emulator"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/kv"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/oplog"
)

// These tests drive the codec with a real Redis client over a real socket,
// because the only question that matters about a wire protocol is whether the
// clients that speak it are satisfied. go-redis is a test-only dependency, the
// way pgx is on the SQL side.
//
// The listener takes an ephemeral port rather than 6379: this repository's own
// docker-compose publishes that one, and a test suite that cannot run while the
// app is up is a test suite nobody runs.

func serve(t *testing.T, seed string, rules []control.Rule) (string, *oplog.Log) {
	t.Helper()

	backend := kv.New()
	t.Cleanup(func() { _ = backend.Close() })

	if seed != "" {
		if err := backend.Seed(json.RawMessage(seed)); err != nil {
			t.Fatalf("seeding: %v", err)
		}
	}
	return serveBackend(t, backend, rules)
}

func serveBackend(t *testing.T, backend emulator.Backend, rules []control.Rule) (string, *oplog.Log) {
	t.Helper()

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

	service := &emulator.Emulator{Proto: New(), Backend: backend}
	go service.Serve(listener, intercept)

	return listener.Addr().String(), log
}

// connect uses go-redis at its own protocol defaults, which means it opens with
// HELLO 3 and has to negotiate down — see
// TestAClientThatOpensWithRESP3NegotiatesDown.
//
// Retries are off. go-redis reconnects and repeats an operation that failed at
// the network level, which would quietly turn a fault the lesson armed into one
// the student never sees, and would make the op log count connections nobody
// asked for.
func connect(t *testing.T, address string) *redis.Client {
	t.Helper()

	client := redis.NewClient(&redis.Options{Addr: address, MaxRetries: -1})
	t.Cleanup(func() { _ = client.Close() })
	return client
}

func TestAClientReadsSeededKeysWithNoShim(t *testing.T) {
	address, _ := serve(t, `{"rate:1": "0", "recent": ["a", "b"], "session:7": {"user": "ada"}}`, nil)
	client := connect(t, address)
	ctx := context.Background()

	if got, err := client.Get(ctx, "rate:1").Result(); err != nil || got != "0" {
		t.Errorf("GET rate:1 = %q, %v, want the seeded counter", got, err)
	}
	if got, err := client.LRange(ctx, "recent", 0, -1).Result(); err != nil || strings.Join(got, ",") != "a,b" {
		t.Errorf("LRANGE recent = %v, %v, want the seeded list", got, err)
	}
	if got, err := client.HGet(ctx, "session:7", "user").Result(); err != nil || got != "ada" {
		t.Errorf("HGET session:7 user = %q, %v, want the seeded hash field", got, err)
	}
}

func TestTheThirdSetFailsAndTheFirstTwoAreStillThere(t *testing.T) {
	address, log := serve(t, "", []control.Rule{{
		Match: "redis.SET", After: 2, Times: 1, Action: control.ActionError,
		Message: "cache write refused",
	}})
	client := connect(t, address)
	ctx := context.Background()

	var failures int
	for attempt := range 3 {
		if err := client.Set(ctx, "key:"+string(rune('a'+attempt)), attempt, 0).Err(); err != nil {
			failures++
			if !strings.Contains(err.Error(), "cache write refused") {
				t.Errorf("attempt %d failed with %v, want the rule's message", attempt, err)
			}
		}
	}

	if failures != 1 {
		t.Fatalf("%d writes failed, want exactly the third", failures)
	}
	// The exception is the easy half. The first two having landed is the half a
	// lesson is actually about.
	for _, key := range []string{"key:a", "key:b"} {
		if _, err := client.Get(ctx, key).Result(); err != nil {
			t.Errorf("GET %s = %v, want the write before the fault to have taken effect", key, err)
		}
	}
	if _, err := client.Get(ctx, "key:c").Result(); !errors.Is(err, redis.Nil) {
		t.Errorf("GET key:c = %v, want the faulted write to have left nothing", err)
	}

	faulted := 0
	for _, entry := range log.Entries() {
		if entry.Fault != "" {
			faulted++
			if entry.Op != "SET" || entry.Target != "key:c" {
				t.Errorf("the fault landed on %s %s, want SET key:c", entry.Op, entry.Target)
			}
		}
	}
	if faulted != 1 {
		t.Errorf("%d operations were faulted, want exactly one", faulted)
	}
}

func TestAClientThatOpensWithRESP3NegotiatesDown(t *testing.T) {
	// go-redis sends HELLO 3 before anything else and treats a Redis error as
	// "this server does not speak it". emu answers NOPROTO, which is what a Redis
	// older than 6 says, and the client carries on in RESP2 without its caller
	// ever hearing about it.
	address, log := serve(t, "", nil)
	client := connect(t, address)

	if err := client.Set(context.Background(), "k", "v", 0).Err(); err != nil {
		t.Fatalf("the client did not survive the refusal: %v", err)
	}

	for _, entry := range log.Entries() {
		if entry.Op == "HELLO" || entry.Op == "CLIENT" {
			t.Errorf("the driver's own bookkeeping reached the op log: %#v", entry)
		}
	}
}

func TestKeysActuallyExpire(t *testing.T) {
	address, _ := serve(t, "", nil)
	client := connect(t, address)
	ctx := context.Background()

	if err := client.Set(ctx, "brief", "v", 60*time.Millisecond).Err(); err != nil {
		t.Fatalf("SET with an expiry: %v", err)
	}
	if got := client.Get(ctx, "brief").Val(); got != "v" {
		t.Fatalf("GET brief = %q before the expiry, want the value", got)
	}
	if ttl := client.TTL(ctx, "brief").Val(); ttl <= 0 {
		t.Errorf("TTL brief = %v, want time left on it", ttl)
	}

	time.Sleep(120 * time.Millisecond)

	if err := client.Get(ctx, "brief").Err(); !errors.Is(err, redis.Nil) {
		t.Errorf("GET brief = %v after the expiry, want a miss", err)
	}
	if size := client.DBSize(ctx).Val(); size != 0 {
		t.Errorf("DBSIZE = %d, want the expired key gone from it too", size)
	}
}

func TestAnIncrementIsAtomicAcrossConnections(t *testing.T) {
	// The reason a cache is emulated rather than stubbed: a rate limiter written
	// against emu behaves the way it will in production.
	address, _ := serve(t, `{"rate:1": "0"}`, nil)
	ctx := context.Background()

	const clients, each = 4, 50
	done := make(chan error, clients)
	for range clients {
		go func() {
			client := redis.NewClient(&redis.Options{Addr: address})
			defer func() { _ = client.Close() }()
			for range each {
				if err := client.Incr(ctx, "rate:1").Err(); err != nil {
					done <- err
					return
				}
			}
			done <- nil
		}()
	}
	for range clients {
		if err := <-done; err != nil {
			t.Fatalf("incrementing: %v", err)
		}
	}

	counter := connect(t, address)
	if total := counter.Get(ctx, "rate:1").Val(); total != "200" {
		t.Errorf("rate:1 = %q, want %d — no increment may be lost", total, clients*each)
	}
}

func TestARefusedConnectionNeverBecomesAUsableOne(t *testing.T) {
	address, _ := serve(t, "", []control.Rule{{
		Match: "redis.CONNECT", Action: control.ActionError, Message: "max number of clients reached",
	}})
	client := connect(t, address)

	err := client.Ping(context.Background()).Err()

	if err == nil || !strings.Contains(err.Error(), "max number of clients reached") {
		t.Errorf("err = %v, want the connection refused with the rule's reason", err)
	}
}

func TestConnectCarriesTheGaugeARuleGatesOn(t *testing.T) {
	address, log := serve(t, "", []control.Rule{{
		Match: "redis.CONNECT", Action: control.ActionError,
		When: control.Conditions{"connections_gte": 1},
	}})
	ctx := context.Background()

	first := connect(t, address)
	if err := first.Ping(ctx).Err(); err != nil {
		t.Fatalf("the first connection was refused: %v", err)
	}

	second := connect(t, address)
	if err := second.Ping(ctx).Err(); err == nil {
		t.Error("a second connection was allowed while one was already open")
	}

	connects := 0
	for _, entry := range log.Entries() {
		if entry.Op == emulator.KindConnect {
			connects++
		}
	}
	if connects != 2 {
		t.Errorf("op log holds %d connections, want both attempts recorded", connects)
	}
}

func TestADroppedConnectionLooksLikeADeadSocket(t *testing.T) {
	address, _ := serve(t, "", []control.Rule{{Match: "redis.GET", Action: control.ActionDropConn}})
	client := connect(t, address)

	err := client.Get(context.Background(), "anything").Err()

	if err == nil || strings.HasPrefix(err.Error(), "ERR") {
		t.Errorf("err = %v, want a broken connection rather than an error reply", err)
	}
}

func TestARuleMayNameTheFailureItWantsAClientToSee(t *testing.T) {
	address, _ := serve(t, "", []control.Rule{{
		Match: "redis.SET", Action: control.ActionError, Code: "OOM",
		Message: "command not allowed when used memory > 'maxmemory'",
	}})
	client := connect(t, address)

	err := client.Set(context.Background(), "k", "v", 0).Err()

	if err == nil || !strings.HasPrefix(err.Error(), "OOM ") {
		t.Errorf("err = %v, want the rule's own Redis prefix so a client can tell it apart", err)
	}
}

func TestADelayedOperationStillAnswers(t *testing.T) {
	address, _ := serve(t, "", []control.Rule{{Match: "redis.*", Action: control.ActionDelay, Millis: 40}})
	client := connect(t, address)

	start := time.Now()
	if err := client.Set(context.Background(), "k", "v", 0).Err(); err != nil {
		t.Fatalf("SET = %v", err)
	}

	if elapsed := time.Since(start); elapsed < 40*time.Millisecond {
		t.Errorf("SET took %v, want the rule's delay to have been honoured", elapsed)
	}
}

func TestPipelinedCommandsAreAnsweredInOrder(t *testing.T) {
	address, _ := serve(t, "", nil)
	client := connect(t, address)
	ctx := context.Background()

	pipe := client.Pipeline()
	pipe.Set(ctx, "a", "1", 0)
	pipe.Incr(ctx, "a")
	pipe.Get(ctx, "a")
	results, err := pipe.Exec(ctx)

	if err != nil {
		t.Fatalf("pipeline: %v", err)
	}
	if len(results) != 3 || results[2].(*redis.StringCmd).Val() != "2" {
		t.Errorf("pipeline = %v, want the three replies in the order they were sent", results)
	}
}
