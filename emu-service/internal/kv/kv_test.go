package kv

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/control"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/emulator"
)

// simple marks a reply that goes out as a RESP simple string rather than a bulk
// one, so that a table can tell +OK from $2 OK — which is the difference between
// TYPE answering "string" and GET answering "string".
type simple string

// a step is one command and what it should answer, written the way it would be
// typed into redis-cli.
type step struct {
	do   string
	want any
	// fail is the error the command should raise instead, verbatim, because the
	// exact wording is what a student debugging against emu has to see.
	fail string
}

func opened(t *testing.T, seed string) emulator.Executor {
	t.Helper()

	backend := New()
	t.Cleanup(func() {
		if err := backend.Close(); err != nil {
			t.Errorf("closing the cache: %v", err)
		}
	})

	if seed != "" {
		if err := backend.Seed(json.RawMessage(seed)); err != nil {
			t.Fatalf("seeding: %v", err)
		}
	}

	executor, err := backend.Open()
	if err != nil {
		t.Fatalf("opening a connection: %v", err)
	}
	t.Cleanup(func() {
		if err := executor.Close(); err != nil {
			t.Errorf("closing the connection: %v", err)
		}
	})
	return executor
}

// reply renders a result the way resp reads it, so that a table says what the
// client would have seen rather than how the result was built.
func reply(result emulator.Result) any {
	if len(result.Rows) == 0 {
		return simple(result.Tag)
	}
	return result.Rows[0][0]
}

func run(executor emulator.Executor, do string) (emulator.Result, error) {
	return executor.Exec(operation(strings.Fields(do)...))
}

// operation is what resp hands the backend: the verb decided, the arguments as
// the client sent them.
func operation(argv ...string) control.Op {
	return control.Op{Kind: strings.ToUpper(argv[0]), Payload: argv}
}

func script(t *testing.T, executor emulator.Executor, steps ...step) {
	t.Helper()

	for index, one := range steps {
		result, err := run(executor, one.do)
		switch {
		case one.fail != "":
			if err == nil || err.Error() != one.fail {
				t.Errorf("step %d, %q: err = %v, want %q", index+1, one.do, err, one.fail)
			}
		case err != nil:
			t.Errorf("step %d, %q: %v", index+1, one.do, err)
		default:
			if got := reply(result); !reflect.DeepEqual(got, one.want) {
				t.Errorf("step %d, %q = %#v, want %#v", index+1, one.do, got, one.want)
			}
		}
	}
}

func TestAConnectionIsNotAnOperationTheCacheHasToPerform(t *testing.T) {
	executor := opened(t, "")

	result, err := executor.Exec(control.Op{Kind: emulator.KindConnect})

	if err != nil || len(result.Rows) != 0 || result.Tag != "" {
		t.Errorf("CONNECT = %#v, %v, want nothing to answer", result, err)
	}
}

func TestACommandTheCacheCannotHaveBeenGivenIsAnEmuBug(t *testing.T) {
	// resp always hands over the decoded argv. Anything else means the two halves
	// of the seam disagree, and saying so beats a nil dereference.
	executor := opened(t, "")

	_, err := executor.Exec(control.Op{Kind: "GET", Payload: "not the arguments"})

	if err == nil || !strings.Contains(err.Error(), "handed a GET with no command") {
		t.Errorf("err = %v, want emu to blame itself out loud", err)
	}
}

func TestAVerbEmuDoesNotKnowIsQuotedBackTheWayRedisDoes(t *testing.T) {
	executor := opened(t, "")

	script(t, executor, step{
		do:   "FROBNICATE the thing",
		fail: "ERR unknown command 'FROBNICATE', with args beginning with: 'the', 'thing', ",
	})
}

func TestTheWrongNumberOfArgumentsNamesTheCommandInLowerCase(t *testing.T) {
	executor := opened(t, "")

	script(t, executor,
		step{do: "GET", fail: "ERR wrong number of arguments for 'get' command"},
		step{do: "GET a b", fail: "ERR wrong number of arguments for 'get' command"},
		step{do: "MSET a 1 b", fail: "ERR wrong number of arguments for 'mset' command"},
		step{do: "HSET h a 1 b", fail: "ERR wrong number of arguments for 'hset' command"},
	)
}

func TestAnOperationTheControlLayerRefusedHasNothingToUndo(t *testing.T) {
	// Redis has no transaction in emu's subset, so Abort exists to answer the
	// interface and to say that, not to do anything.
	executor := opened(t, `{"k": "v"}`)

	executor.Abort(control.Op{Kind: "SET", Target: "k"})

	script(t, executor, step{do: "GET k", want: "v"})
}

func TestSeedingReadsTheShapeOffTheJSON(t *testing.T) {
	executor := opened(t, `{"rate:1": "0", "recent": ["a", "b"], "session:7": {"user": "ada"}}`)

	script(t, executor,
		step{do: "GET rate:1", want: "0"},
		step{do: "TYPE rate:1", want: simple("string")},
		step{do: "LRANGE recent 0 -1", want: []string{"a", "b"}},
		step{do: "TYPE recent", want: simple("list")},
		step{do: "HGET session:7 user", want: "ada"},
		step{do: "TYPE session:7", want: simple("hash")},
	)
}

func TestSeedingIntoTheFirstDatabaseAndNoOther(t *testing.T) {
	executor := opened(t, `{"k": "v"}`)

	script(t, executor,
		step{do: "SELECT 1", want: simple("OK")},
		step{do: "DBSIZE", want: 0},
		step{do: "SELECT 0", want: simple("OK")},
		step{do: "DBSIZE", want: 1},
	)
}

func TestASeedThatCouldNotBeAppliedFailsTheRun(t *testing.T) {
	for _, broken := range []struct {
		name  string
		seed  string
		blame string
	}{
		{"not an object", `["SET k v"]`, "want an object of keys to values"},
		{"a value of a shape no key has", `{"k": 7}`, `key "k": want a string, a list of strings`},
	} {
		t.Run(broken.name, func(t *testing.T) {
			err := New().Seed(json.RawMessage(broken.seed))

			if err == nil || !strings.Contains(err.Error(), broken.blame) {
				t.Errorf("Seed = %v, want it to say %q", err, broken.blame)
			}
		})
	}
}

func TestNoSeedIsNotAFailure(t *testing.T) {
	if err := New().Seed(nil); err != nil {
		t.Errorf("Seed(nil) = %v, want a lesson that seeds nothing to start anyway", err)
	}
}

func TestTwoConnectionsShareTheKeySpaceButNotTheDatabaseTheyChose(t *testing.T) {
	backend := New()
	t.Cleanup(func() { _ = backend.Close() })

	first, err := backend.Open()
	if err != nil {
		t.Fatalf("opening: %v", err)
	}
	second, err := backend.Open()
	if err != nil {
		t.Fatalf("opening: %v", err)
	}

	script(t, first, step{do: "SET shared yes", want: simple("OK")})
	script(t, second,
		step{do: "GET shared", want: "yes"},
		step{do: "SELECT 3", want: simple("OK")},
		step{do: "GET shared", want: nil},
	)
	script(t, first, step{do: "GET shared", want: "yes"})
}
