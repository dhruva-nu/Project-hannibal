package kv

import "github.com/dhruva-nu/Project-hannibal/emu-service/internal/emulator"

// A handler runs one command's arguments, the verb already stripped and the
// arity already checked. The backend's lock is held.
type handler func(*executor, []string) (emulator.Result, error)

// A command is one verb: how many arguments it will take, and what it does.
type command struct {
	// least and most bound the arguments after the verb. A most of -1 is
	// unbounded, which is how Redis writes a negative arity.
	least int
	most  int
	run   handler
}

// commands is the whole vocabulary emu speaks. It is deliberately the commands
// lessons need and no more: every entry here is one a test drives, and a verb
// emu half-implements is worse than one it refuses, because the student debugs
// their own code instead of the emulator's.
//
// Everything a Redis client sends on its own behalf — HELLO, CLIENT, COMMAND —
// is answered in resp and never reaches this table, the way pgwire answers
// DEALLOCATE without troubling SQLite. Those are the driver talking, not the
// lesson, and the op log a student is graded from should not carry them.
var commands = map[string]command{
	"PING":    {0, 1, ping},
	"ECHO":    {1, 1, echo},
	"SELECT":  {1, 1, selectDatabase},
	"INFO":    {0, 1, info},
	"DBSIZE":  {0, 0, dbsize},
	"FLUSHDB": {0, 1, flushdb},

	"DEL":    {1, -1, del},
	"EXISTS": {1, -1, exists},
	"EXPIRE": {2, 2, expire},
	"TTL":    {1, 1, ttl},
	"TYPE":   {1, 1, typeOf},
	"KEYS":   {1, 1, keys},
	"SCAN":   {1, -1, scan},

	"GET":    {1, 1, get},
	"SET":    {2, -1, set},
	"SETEX":  {3, 3, setex},
	"GETSET": {2, 2, getset},
	"MGET":   {1, -1, mget},
	"MSET":   {2, -1, mset},
	"APPEND": {2, 2, appendTo},
	"STRLEN": {1, 1, strlen},
	"INCR":   {1, 1, incrementBy(1)},
	"DECR":   {1, 1, incrementBy(-1)},
	"INCRBY": {2, 2, incrementByArgument(1)},
	"DECRBY": {2, 2, incrementByArgument(-1)},

	"HSET":    {3, -1, hset},
	"HGET":    {2, 2, hget},
	"HDEL":    {2, -1, hdel},
	"HGETALL": {1, 1, hgetall},
	"HKEYS":   {1, 1, hfields(hashKeys)},
	"HVALS":   {1, 1, hfields(hashValues)},

	"LPUSH":  {2, -1, push(atFront)},
	"RPUSH":  {2, -1, push(atBack)},
	"LPOP":   {1, 1, pop(atFront)},
	"RPOP":   {1, 1, pop(atBack)},
	"LRANGE": {3, 3, lrange},
	"LLEN":   {1, 1, llen},

	"SADD":      {2, -1, sadd},
	"SREM":      {2, -1, srem},
	"SMEMBERS":  {1, 1, smembers},
	"SISMEMBER": {2, 2, sismember},
	"SCARD":     {1, 1, scard},
}

// A result carries one RESP reply, and the two shapes below are the whole
// vocabulary kv and resp share.
//
// status is a simple string — +OK, +PONG — which is what emulator.Result.Tag
// already means: "what the client is told the operation did, in the protocol's
// own words".
//
// value is everything else, held as the single cell of a single row. resp writes
// it by its Go type: nil is a null bulk string, a string is a bulk string, an int
// is an integer, and a []string or []any is an array. Nothing else is allowed
// through, and resp says so loudly if it ever is.
func status(text string) emulator.Result { return emulator.Result{Tag: text} }

func value(held any) emulator.Result { return emulator.Result{Rows: [][]any{{held}}} }
