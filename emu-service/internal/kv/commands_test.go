package kv

import (
	"strings"
	"testing"
	"time"
)

// The command tests are scripts rather than one test per verb: what matters
// about a cache is what a sequence of commands leaves behind, and a table of
// (command, reply) pairs reads like a redis-cli session that somebody can check
// against a real Redis.

func TestStrings(t *testing.T) {
	script(t, opened(t, ""),
		step{do: "SET greeting hello", want: simple("OK")},
		step{do: "GET greeting", want: "hello"},
		step{do: "GET nothing", want: nil},
		step{do: "STRLEN greeting", want: 5},
		step{do: "STRLEN nothing", want: 0},
		step{do: "APPEND greeting !", want: 6},
		step{do: "APPEND fresh new", want: 3},
		step{do: "GETSET greeting bye", want: "hello!"},
		step{do: "GETSET unset first", want: nil},
		step{do: "GET greeting", want: "bye"},
		step{do: "MSET a 1 b 2", want: simple("OK")},
		step{do: "MGET a b missing", want: []any{"1", "2", nil}},
	)
}

func TestMGETAnswersNilForAKeyThatIsNotAString(t *testing.T) {
	// Redis does not fail the whole read for one key of the wrong kind, and a
	// bulk read that did would be unusable.
	script(t, opened(t, ""),
		step{do: "RPUSH queue a", want: 1},
		step{do: "SET plain v", want: simple("OK")},
		step{do: "MGET plain queue", want: []any{"v", nil}},
	)
}

func TestCounters(t *testing.T) {
	script(t, opened(t, `{"rate:1": "0"}`),
		step{do: "INCR rate:1", want: 1},
		step{do: "INCR rate:1", want: 2},
		step{do: "INCRBY rate:1 10", want: 12},
		step{do: "DECR rate:1", want: 11},
		step{do: "DECRBY rate:1 11", want: 0},
		step{do: "INCR fresh", want: 1},
		step{do: "GET rate:1", want: "0"},
	)
}

func TestACounterRefusesWhatIsNotANumber(t *testing.T) {
	script(t, opened(t, ""),
		step{do: "SET blob {}", want: simple("OK")},
		step{do: "INCR blob", fail: string(ErrNotInteger)},
		step{do: "INCRBY blob nine", fail: string(ErrNotInteger)},
		step{do: "SET big 9223372036854775807", want: simple("OK")},
		step{do: "INCR big", fail: string(ErrOverflow)},
		step{do: "SET small -9223372036854775808", want: simple("OK")},
		step{do: "DECR small", fail: string(ErrOverflow)},
		// Negating the most negative int64 is the one step with no opposite.
		step{do: "DECRBY any -9223372036854775808", fail: string(ErrOverflow)},
	)
}

func TestSetOptions(t *testing.T) {
	script(t, opened(t, ""),
		step{do: "SET k first NX", want: simple("OK")},
		step{do: "SET k second NX", want: nil},
		step{do: "GET k", want: "first"},
		step{do: "SET k second XX", want: simple("OK")},
		step{do: "SET absent value XX", want: nil},
		step{do: "GET absent", want: nil},
		step{do: "SET k third EX 100", want: simple("OK")},
		step{do: "TTL k", want: 100},
		step{do: "SET k fourth KEEPTTL", want: simple("OK")},
		step{do: "TTL k", want: 100},
		step{do: "SET k fifth", want: simple("OK")},
		step{do: "TTL k", want: -1},
	)
}

func TestSetRefusesOptionsItWouldOtherwiseHaveToIgnore(t *testing.T) {
	// A SET whose NX was silently dropped would let a lesson about locks pass
	// everyone, so an unread word is an error rather than noise.
	script(t, opened(t, ""),
		step{do: "SET k v SOMETHING", fail: string(ErrSyntax)},
		step{do: "SET k v NX XX", fail: string(ErrSyntax)},
		step{do: "SET k v EX", fail: string(ErrSyntax)},
		step{do: "SET k v EX soon", fail: string(ErrNotInteger)},
		step{do: "SET k v EX 0", fail: "ERR invalid expire time in 'set' command"},
		step{do: "SET k v EX 9223372036854775807", fail: "ERR invalid expire time in 'set' command"},
		step{do: "SETEX k soon v", fail: string(ErrNotInteger)},
		step{do: "SETEX k -1 v", fail: "ERR invalid expire time in 'setex' command"},
	)
}

func TestSetOverwritesWhateverKindWasThere(t *testing.T) {
	// SET is not a typed write, which is why it is one of the few commands that
	// never answers WRONGTYPE.
	script(t, opened(t, ""),
		step{do: "RPUSH k a", want: 1},
		step{do: "SET k plain", want: simple("OK")},
		step{do: "TYPE k", want: simple("string")},
	)
}

func TestTheWrongKindOfKeyFailsTheWayRedisSaysIt(t *testing.T) {
	wrong := string(ErrWrongType)
	script(t, opened(t, ""),
		step{do: "RPUSH queue a", want: 1},
		step{do: "GET queue", fail: wrong},
		step{do: "GETSET queue v", fail: wrong},
		step{do: "APPEND queue v", fail: wrong},
		step{do: "STRLEN queue", fail: wrong},
		step{do: "INCR queue", fail: wrong},
		step{do: "HGET queue f", fail: wrong},
		step{do: "HSET queue f v", fail: wrong},
		step{do: "HDEL queue f", fail: wrong},
		step{do: "HGETALL queue", fail: wrong},
		step{do: "HKEYS queue", fail: wrong},
		step{do: "SADD queue m", fail: wrong},
		step{do: "SREM queue m", fail: wrong},
		step{do: "SMEMBERS queue", fail: wrong},
		step{do: "SISMEMBER queue m", fail: wrong},
		step{do: "SCARD queue", fail: wrong},
		step{do: "SET plain v", want: simple("OK")},
		step{do: "LPUSH plain a", fail: wrong},
		step{do: "LPOP plain", fail: wrong},
		step{do: "LRANGE plain 0 -1", fail: wrong},
		step{do: "LLEN plain", fail: wrong},
	)
}

func TestHashes(t *testing.T) {
	script(t, opened(t, ""),
		step{do: "HSET session user ada role admin", want: 2},
		step{do: "HSET session user grace", want: 0},
		step{do: "HGET session user", want: "grace"},
		step{do: "HGET session missing", want: nil},
		step{do: "HGET absent user", want: nil},
		step{do: "HKEYS session", want: []string{"role", "user"}},
		step{do: "HVALS session", want: []string{"admin", "grace"}},
		step{do: "HGETALL session", want: map[string]string{"role": "admin", "user": "grace"}},
		step{do: "HGETALL absent", want: map[string]string{}},
		step{do: "HKEYS absent", want: []string{}},
		step{do: "HDEL session role missing", want: 1},
		step{do: "HDEL absent role", want: 0},
		step{do: "HDEL session user", want: 1},
		// Redis has no empty hash: removing the last field removes the key.
		step{do: "EXISTS session", want: 0},
	)
}

func TestLists(t *testing.T) {
	script(t, opened(t, ""),
		step{do: "RPUSH queue b c", want: 2},
		step{do: "LPUSH queue a", want: 3},
		step{do: "LRANGE queue 0 -1", want: []string{"a", "b", "c"}},
		step{do: "LRANGE queue 1 1", want: []string{"b"}},
		step{do: "LRANGE queue -2 -1", want: []string{"b", "c"}},
		step{do: "LRANGE queue 0 99", want: []string{"a", "b", "c"}},
		step{do: "LRANGE queue 2 1", want: []string{}},
		step{do: "LRANGE queue -99 -50", want: []string{}},
		step{do: "LRANGE absent 0 -1", want: []string{}},
		step{do: "LLEN queue", want: 3},
		step{do: "LLEN absent", want: 0},
		step{do: "LPOP queue", want: "a"},
		step{do: "RPOP queue", want: "c"},
		step{do: "LPOP absent", want: nil},
		step{do: "LPOP queue", want: "b"},
		// Redis has no empty list either.
		step{do: "EXISTS queue", want: 0},
	)
}

func TestLRangeRefusesAnIndexThatIsNotANumberBeforeItLooksAtTheKey(t *testing.T) {
	script(t, opened(t, ""),
		step{do: "LRANGE queue start -1", fail: string(ErrNotInteger)},
		step{do: "LRANGE queue 0 end", fail: string(ErrNotInteger)},
	)
}

func TestSets(t *testing.T) {
	script(t, opened(t, ""),
		step{do: "SADD tags go redis go", want: 2},
		step{do: "SMEMBERS tags", want: []string{"go", "redis"}},
		step{do: "SMEMBERS absent", want: []string{}},
		step{do: "SISMEMBER tags go", want: 1},
		step{do: "SISMEMBER tags rust", want: 0},
		step{do: "SISMEMBER absent go", want: 0},
		step{do: "SCARD tags", want: 2},
		step{do: "SCARD absent", want: 0},
		step{do: "SREM tags rust", want: 0},
		step{do: "SREM absent go", want: 0},
		step{do: "SREM tags go redis", want: 2},
		step{do: "EXISTS tags", want: 0},
	)
}

func TestTheKeyspace(t *testing.T) {
	script(t, opened(t, ""),
		step{do: "MSET user:1 a user:2 b other c", want: simple("OK")},
		step{do: "EXISTS user:1", want: 1},
		step{do: "EXISTS user:1 user:1 missing", want: 3 - 1},
		step{do: "EXISTS missing", want: 0},
		step{do: "TYPE missing", want: simple("none")},
		step{do: "KEYS *", want: []string{"other", "user:1", "user:2"}},
		step{do: "KEYS user:*", want: []string{"user:1", "user:2"}},
		step{do: "DBSIZE", want: 3},
		step{do: "DEL user:1 missing", want: 1},
		step{do: "DBSIZE", want: 2},
		step{do: "FLUSHDB", want: simple("OK")},
		step{do: "DBSIZE", want: 0},
	)
}

func TestScan(t *testing.T) {
	script(t, opened(t, `{"user:1": "a", "user:2": "b", "other": "c"}`),
		step{do: "SCAN 0", want: []any{"0", []string{"other", "user:1", "user:2"}}},
		step{do: "SCAN 0 MATCH user:*", want: []any{"0", []string{"user:1", "user:2"}}},
		step{do: "SCAN 0 COUNT 10 MATCH user:1", want: []any{"0", []string{"user:1"}}},
		// emu never issues a cursor other than zero, so one it is handed back has
		// nothing left to give.
		step{do: "SCAN 7", want: []any{"0", []string{}}},
		step{do: "SCAN later", fail: string(ErrCursor)},
		step{do: "SCAN 0 MATCH", fail: string(ErrSyntax)},
		step{do: "SCAN 0 TYPE string", fail: string(ErrSyntax)},
		step{do: "SCAN 0 COUNT many", fail: string(ErrNotInteger)},
		step{do: "SCAN 0 COUNT 0", fail: string(ErrSyntax)},
	)
}

func TestTTLsActuallyPass(t *testing.T) {
	executor := opened(t, "")

	script(t, executor,
		step{do: "TTL missing", want: -2},
		step{do: "SET forever v", want: simple("OK")},
		step{do: "TTL forever", want: -1},
		step{do: "SET brief v PX 40", want: simple("OK")},
		step{do: "TTL brief", want: 1},
		step{do: "SETEX also 100 v", want: simple("OK")},
		step{do: "TTL also", want: 100},
		step{do: "DBSIZE", want: 3},
	)

	time.Sleep(80 * time.Millisecond)

	script(t, executor,
		step{do: "GET brief", want: nil},
		step{do: "EXISTS brief", want: 0},
		step{do: "DBSIZE", want: 2},
		step{do: "KEYS *", want: []string{"also", "forever"}},
	)
}

func TestExpire(t *testing.T) {
	executor := opened(t, "")

	script(t, executor,
		step{do: "SET k v", want: simple("OK")},
		step{do: "EXPIRE missing 10", want: 0},
		step{do: "EXPIRE k soon", fail: string(ErrNotInteger)},
		step{do: "EXPIRE k 9223372036854775807", fail: "ERR invalid expire time in 'expire' command"},
		step{do: "EXPIRE k 100", want: 1},
		step{do: "TTL k", want: 100},
		// A TTL already in the past deletes the key rather than being refused.
		step{do: "EXPIRE k -1", want: 1},
		step{do: "EXISTS k", want: 0},
	)
}

func TestTheServerCommandsAClientLeansOn(t *testing.T) {
	script(t, opened(t, ""),
		step{do: "PING", want: simple("PONG")},
		step{do: "PING hello", want: "hello"},
		step{do: "ECHO hello", want: "hello"},
		step{do: "SELECT 15", want: simple("OK")},
		step{do: "SELECT sixteen", fail: string(ErrNotInteger)},
		step{do: "SELECT 16", fail: string(ErrDBIndex)},
		step{do: "SELECT -1", fail: string(ErrDBIndex)},
		step{do: "FLUSHDB ASYNC", want: simple("OK")},
	)
}

func TestInfoReportsWhatEmuIsAndWhatItHolds(t *testing.T) {
	executor := opened(t, `{"k": "v"}`)
	script(t, executor, step{do: "SET brief v EX 100", want: simple("OK")})

	result, err := run(executor, "INFO server")
	if err != nil {
		t.Fatalf("INFO: %v", err)
	}

	report, ok := reply(result).(string)
	if !ok {
		t.Fatalf("INFO = %#v, want a bulk string", reply(result))
	}
	for _, line := range []string{
		"redis_version:" + serverVersion,
		"emulated:1",
		"db0:keys=2,expires=1,avg_ttl=0",
	} {
		if !strings.Contains(report, line) {
			t.Errorf("INFO does not report %q:\n%s", line, report)
		}
	}
	if strings.Contains(report, "db1:") {
		t.Errorf("INFO reports a database nothing is in:\n%s", report)
	}
}

func TestAValueMayHoldAnythingIncludingNothing(t *testing.T) {
	// The script helper splits on spaces, so the one case it cannot express gets
	// its own test: a value is bytes, not a word.
	executor := opened(t, "")

	if _, err := executor.Exec(operation("SET", "k", "a value with spaces")); err != nil {
		t.Fatalf("SET: %v", err)
	}
	if _, err := executor.Exec(operation("SET", "empty", "")); err != nil {
		t.Fatalf("SET: %v", err)
	}

	script(t, executor,
		step{do: "GET k", want: "a value with spaces"},
		step{do: "GET empty", want: ""},
		step{do: "STRLEN empty", want: 0},
		step{do: "EXISTS empty", want: 1},
	)
}
