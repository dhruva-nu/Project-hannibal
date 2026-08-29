// Package kv answers cache semantics for the emulated Redis, the way sqlitedb
// answers SQL semantics for the emulated Postgres.
//
// # Why not miniredis
//
// The plan named github.com/alicebob/miniredis. It does not fit, for three
// independent reasons, each of which is on its own enough:
//
//   - It cannot be driven in-process. Miniredis.start is unexported and takes a
//     *server.Server, which only server.NewServer(addr) and NewServerTLS build —
//     both of which bind a TCP listener before any command is registered. There
//     is no constructor that gives you a command-registered miniredis without a
//     socket of its own. Inside emu that means a second listener on loopback that
//     student code reaches directly, and every operation through it skips
//     Interceptor.Before. Loopback exists under --network none and the student
//     shares emu's uid, so that is not a hypothetical: it is the fault-disarming
//     hole the whole threat model exists to close.
//   - Its one interception point, Server.SetPreHook, fires inside miniredis's own
//     dispatch loop on miniredis's own listener. Taking it would put emu's control
//     point in two places, leave fleet unable to bind 6379, leave emulator.Serve
//     unused on the cache path, and — since a pre-command hook has no accept hook
//     beside it — leave redis.CONNECT with nowhere to come from.
//   - Its TTLs do not decrease. "Since miniredis is intended to be used in
//     unittests TTLs don't decrease automatically", says its README; time only
//     moves when the test calls FastForward. A cache whose keys never expire is
//     not a cache lesson.
//
// Its direct API (Set, Get, Incr, …) sidesteps the first two but is a key space,
// not command semantics: no arity checks, no SET … NX EX, no SCAN cursor, no
// MGET, no Redis error strings, and still no clock. Everything below would have
// had to be written anyway, on top of 2.4 MB of linked library.
//
// So this package is the key space, and it is the smaller half of the phase.
package kv

import (
	"encoding/json"
	"fmt"
	"maps"
	"slices"
	"sync"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/control"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/emulator"
)

// databases is how many numbered key spaces SELECT can reach. Redis ships
// sixteen and clients default to the first, so a lesson that never says SELECT
// never notices the other fifteen exist.
const databases = 16

// A Backend is one emulated cache: every database, and the lock that makes a
// command atomic.
type Backend struct {
	// mutex covers every space. Real Redis executes one command at a time on one
	// thread, which is what makes INCR atomic without anything further; emu holds
	// a lock for exactly as long, so the same guarantee holds for the same reason.
	mutex  sync.Mutex
	spaces []*space
}

// New opens an empty cache.
func New() *Backend {
	spaces := make([]*space, databases)
	for index := range spaces {
		spaces[index] = newSpace()
	}
	return &Backend{spaces: spaces}
}

// Seed fills database zero from the lesson's config, before any client can
// connect. The shape is the plan's — an object of keys to values — widened by
// what the value is:
//
//	{"rate:1": "0", "recent": ["a", "b"], "session:7": {"user": "ada"}}
//
// A string seeds a string, a list seeds a list, an object seeds a hash. Sets are
// deliberately not seedable: a JSON array already means a list, and inventing a
// tagged encoding to tell the two apart would cost a lesson author more than the
// one SADD it saves. Seeding fails the run rather than the student, because a
// lesson whose fixture did not load grades against a cache it does not describe.
func (b *Backend) Seed(raw json.RawMessage) error {
	if len(raw) == 0 {
		return nil
	}

	var seed map[string]json.RawMessage
	if err := json.Unmarshal(raw, &seed); err != nil {
		return fmt.Errorf("seed for redis: want an object of keys to values: %w", err)
	}
	// Sorted, so that a seed that is partly bad always blames the same key.
	for _, key := range slices.Sorted(maps.Keys(seed)) {
		if err := b.spaces[0].seed(key, seed[key]); err != nil {
			return fmt.Errorf("seed for redis, key %q: %w", key, err)
		}
	}
	return nil
}

// Open gives one client connection its own executor. The key space is shared —
// a cache that two connections could not both see would be no cache — but which
// database is selected belongs to the connection that selected it.
func (b *Backend) Open() (emulator.Executor, error) {
	return &executor{backend: b}, nil
}

// Close has nothing to release. The cache is a map in this process's heap, and
// it goes when the process does; there is no file, no socket, and nothing that
// survives the run.
func (b *Backend) Close() error { return nil }

// An executor runs one connection's commands against the database it selected.
type executor struct {
	backend  *Backend
	selected int
}

// Exec runs one decoded command. Arity and the command table are checked here
// rather than in the protocol, so that resp stays a codec and every rule still
// sees the operation — a lesson that fails the third SET must fail a malformed
// third SET too, or the fault is dodgeable by writing worse code.
func (e *executor) Exec(op control.Op) (emulator.Result, error) {
	if op.Kind == emulator.KindConnect {
		return emulator.Result{}, nil
	}

	argv, decoded := op.Payload.([]string)
	if !decoded || len(argv) == 0 {
		return emulator.Result{}, fmt.Errorf("the cache backend was handed a %s with no command", op.Kind)
	}

	e.backend.mutex.Lock()
	defer e.backend.mutex.Unlock()

	return e.run(op.Kind, argv)
}

// Abort has nothing to undo, and that is worth saying rather than leaving blank.
// Redis has no transaction in emu's subset, so an operation the control layer
// refused never half-happened: it did not happen. sqlitedb needs Abort because a
// faulted COMMIT must leave its writes absent; a faulted SET simply did not set.
func (e *executor) Abort(control.Op) {}

func (e *executor) Close() error { return nil }

func (e *executor) run(kind string, argv []string) (emulator.Result, error) {
	command, known := commands[kind]
	if !known {
		return emulator.Result{}, unknownCommand(argv)
	}

	args := argv[1:]
	if len(args) < command.least || (command.most >= 0 && len(args) > command.most) {
		return emulator.Result{}, wrongArity(kind)
	}
	return command.run(e, args)
}

// space is the database this connection is working in.
func (e *executor) space() *space { return e.backend.spaces[e.selected] }
