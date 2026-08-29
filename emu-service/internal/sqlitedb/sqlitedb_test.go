package sqlitedb

import (
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/control"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/emulator"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/sqltext"
)

func newBackend(t *testing.T, seed ...string) *Backend {
	t.Helper()

	backend, err := New()
	if err != nil {
		t.Fatalf("opening the database: %v", err)
	}
	t.Cleanup(func() { _ = backend.Close() })

	if len(seed) > 0 {
		raw, err := json.Marshal(seed)
		if err != nil {
			t.Fatalf("marshalling the seed: %v", err)
		}
		if err := backend.Seed(raw); err != nil {
			t.Fatalf("seeding: %v", err)
		}
	}
	return backend
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

// run is one statement through the whole path a client's would take.
func run(t *testing.T, executor emulator.Executor, sql string, params ...any) emulator.Result {
	t.Helper()

	result, err := exec(executor, sql, params...)
	if err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
	return result
}

func exec(executor emulator.Executor, sql string, params ...any) (emulator.Result, error) {
	statement := sqltext.Parse(sql, params)
	return executor.Exec(control.Op{Kind: statement.Kind, Payload: statement})
}

func TestSeedRunsTheLessonsStatementsInOrder(t *testing.T) {
	backend := newBackend(t,
		"CREATE TABLE accounts (id INT PRIMARY KEY, balance INT)",
		"INSERT INTO accounts VALUES (1, 100), (2, 50)",
	)

	result := run(t, open(t, backend), "SELECT id, balance FROM accounts ORDER BY id")

	if result.Tag != "SELECT 2" {
		t.Errorf("tag = %q, want the row count", result.Tag)
	}
	if len(result.Rows) != 2 || result.Rows[0][1] != int64(100) {
		t.Errorf("rows = %#v, want the seeded ones", result.Rows)
	}
}

func TestSeedRefusesWhatItCannotApply(t *testing.T) {
	for name, testCase := range map[string]struct {
		seed  string
		names string
	}{
		"a shape that is not a list of statements": {`{"accounts": []}`, "list of SQL statements"},
		"a statement the engine rejects":           {`["CREATE TABLE ("]`, "statement 1"},
	} {
		t.Run(name, func(t *testing.T) {
			backend := newBackend(t)

			err := backend.Seed(json.RawMessage(testCase.seed))

			if err == nil || !strings.Contains(err.Error(), testCase.names) {
				t.Errorf("err = %v, want it to name %q", err, testCase.names)
			}
		})
	}
}

func TestAnAbsentSeedLeavesAnEmptyDatabase(t *testing.T) {
	backend := newBackend(t)

	if err := backend.Seed(nil); err != nil {
		t.Fatalf("Seed(nil) = %v, want a lesson with no fixture to be fine", err)
	}
	if _, err := exec(open(t, backend), "SELECT 1 FROM accounts"); err == nil {
		t.Error("a table exists that nothing created")
	}
}

func TestTwoConnectionsSeeOneDatabase(t *testing.T) {
	backend := newBackend(t, "CREATE TABLE t (id INT)")
	first, second := open(t, backend), open(t, backend)

	run(t, first, "INSERT INTO t VALUES (1)")

	if rows := run(t, second, "SELECT id FROM t").Rows; len(rows) != 1 {
		t.Errorf("the second connection saw %#v, want the first connection's write", rows)
	}
}

func TestEachConnectionsTransactionIsItsOwn(t *testing.T) {
	backend := newBackend(t, "CREATE TABLE t (id INT)")
	writer, reader := open(t, backend), open(t, backend)

	run(t, writer, "BEGIN")
	run(t, writer, "INSERT INTO t VALUES (1)")

	if rows := run(t, reader, "SELECT id FROM t").Rows; len(rows) != 0 {
		t.Errorf("the reader saw %#v before the writer committed", rows)
	}

	run(t, writer, "COMMIT")

	if rows := run(t, reader, "SELECT id FROM t").Rows; len(rows) != 1 {
		t.Errorf("the reader saw %#v after the commit, want the row", rows)
	}
}

func TestAFaultedCommitLeavesItsWritesAbsent(t *testing.T) {
	// The whole point of P3. An exception the student can catch while the rows
	// landed anyway teaches the opposite of the lesson.
	backend := newBackend(t, "CREATE TABLE accounts (id INT PRIMARY KEY, balance INT)", "INSERT INTO accounts VALUES (1, 100)")
	executor := open(t, backend)

	run(t, executor, "BEGIN")
	run(t, executor, "UPDATE accounts SET balance = balance - 10 WHERE id = 1")
	executor.Abort(control.Op{Kind: sqltext.KindCommit})

	balance := run(t, executor, "SELECT balance FROM accounts WHERE id = 1").Rows[0][0]
	if balance != int64(100) {
		t.Errorf("balance = %v, want 100: the faulted transaction must have rolled back", balance)
	}
}

func TestAFaultedStatementPoisonsTheTransactionItWasInside(t *testing.T) {
	backend := newBackend(t, "CREATE TABLE t (id INT)")
	executor := open(t, backend)

	run(t, executor, "BEGIN")
	executor.Abort(control.Op{Kind: sqltext.KindSelect})

	_, err := exec(executor, "SELECT id FROM t")
	if err == nil || !strings.Contains(err.Error(), "aborted") {
		t.Fatalf("err = %v, want the block refused until it ends", err)
	}

	run(t, executor, "ROLLBACK")
	run(t, executor, "SELECT id FROM t")
}

func TestAFaultOutsideATransactionPoisonsNothing(t *testing.T) {
	backend := newBackend(t, "CREATE TABLE t (id INT)")
	executor := open(t, backend)

	executor.Abort(control.Op{Kind: sqltext.KindSelect})

	run(t, executor, "SELECT id FROM t")
}

func TestAStatementThatFailsInsideATransactionAbortsTheBlock(t *testing.T) {
	backend := newBackend(t, "CREATE TABLE t (id INT)")
	executor := open(t, backend)

	run(t, executor, "BEGIN")
	if _, err := exec(executor, "SELECT id FROM nope"); err == nil {
		t.Fatal("a missing table did not fail")
	}

	_, err := exec(executor, "SELECT id FROM t")
	if err == nil || !strings.Contains(err.Error(), "aborted") {
		t.Fatalf("err = %v, want 25P02 until the block ends", err)
	}

	// Postgres answers ROLLBACK to a COMMIT of a transaction that already failed.
	if tag := run(t, executor, "COMMIT").Tag; tag != sqltext.KindRollback {
		t.Errorf("tag = %q, want ROLLBACK", tag)
	}
	run(t, executor, "SELECT id FROM t")
}

func TestTransactionVerbsOutsideABlockAreHarmless(t *testing.T) {
	executor := open(t, newBackend(t, "CREATE TABLE t (id INT)"))

	for _, sql := range []string{"COMMIT", "ROLLBACK", "BEGIN", "BEGIN"} {
		run(t, executor, sql)
	}
	run(t, executor, "ROLLBACK")
}

func TestACommitThatTheEngineRefusesIsReported(t *testing.T) {
	backend := newBackend(t, "CREATE TABLE t (id INT)")
	executor := open(t, backend)

	run(t, executor, "BEGIN")
	// Ending the transaction behind the session's back is how a commit fails
	// without a broken disk: a client still has to be told when one does.
	_ = executor.(*connection).tx.Rollback()

	if _, err := exec(executor, "COMMIT"); err == nil {
		t.Error("a commit that could not happen was reported as done")
	}
}

func TestConnectIsAcknowledgedWithoutTouchingTheDatabase(t *testing.T) {
	executor := open(t, newBackend(t))

	result, err := executor.Exec(control.Op{Kind: emulator.KindConnect})

	if err != nil || result.Tag != "" {
		t.Errorf("Exec(CONNECT) = %#v, %v, want an empty acknowledgement", result, err)
	}
}

func TestAnOperationWithNoStatementFailsLoudly(t *testing.T) {
	executor := open(t, newBackend(t))

	_, err := executor.Exec(control.Op{Kind: sqltext.KindSelect})

	if err == nil || !strings.Contains(err.Error(), "no statement") {
		t.Errorf("err = %v, want it to say the payload was missing", err)
	}
}

func TestTagsCarryTheCountAClientReadsRowcountFrom(t *testing.T) {
	executor := open(t, newBackend(t, "CREATE TABLE t (id INT, name TEXT)"))

	// In order, because each statement's count depends on what ran before it.
	for _, step := range []struct{ sql, want string }{
		{"BEGIN", "BEGIN"},
		{"INSERT INTO t VALUES (1, 'a'), (2, 'b')", "INSERT 0 2"},
		{"UPDATE t SET name = 'c'", "UPDATE 2"},
		{"SELECT id FROM t", "SELECT 2"},
		{"VALUES (1), (2), (3)", "SELECT 3"},
		{"DELETE FROM t", "DELETE 2"},
		{"CREATE TABLE later (x INT)", "CREATE TABLE"},
		{"COMMIT", "COMMIT"},
	} {
		if tag := run(t, executor, step.sql).Tag; tag != step.want {
			t.Errorf("%s -> tag %q, want %q", step.sql, tag, step.want)
		}
	}
}

func TestReturningIsAResultSet(t *testing.T) {
	executor := open(t, newBackend(t, "CREATE TABLE t (id INT, name TEXT)"))

	result := run(t, executor, "INSERT INTO t VALUES (1, 'a') RETURNING id, name")

	if result.Tag != "INSERT 0 1" || len(result.Rows) != 1 {
		t.Errorf("result = %#v, want the inserted row back under an INSERT tag", result)
	}
}

func TestParametersAreBoundByPosition(t *testing.T) {
	executor := open(t, newBackend(t, "CREATE TABLE t (id INT, name TEXT)", "INSERT INTO t VALUES (1, 'a'), (2, 'b')"))

	result := run(t, executor, "SELECT name FROM t WHERE id > $1 AND id > $1", int64(1))

	if len(result.Rows) != 1 || result.Rows[0][0] != "b" {
		t.Errorf("rows = %#v, want the repeated placeholder to be one parameter", result.Rows)
	}
}

func TestColumnTypesComeFromTheSchemaAndThenFromTheValues(t *testing.T) {
	executor := open(t, newBackend(t,
		"CREATE TABLE t (i INT, s TEXT, b BOOLEAN, f REAL, at TIMESTAMP, raw BLOB, undeclared)",
		"INSERT INTO t VALUES (1, 'a', 1, 1.5, '2024-01-02 03:04:05', x'01', 'text')",
	))

	result := run(t, executor, "SELECT i, s, b, f, at, raw, undeclared, count(*), i * 1.5 FROM t")

	want := []emulator.Type{
		emulator.TypeInteger, emulator.TypeText, emulator.TypeBool, emulator.TypeFloat,
		emulator.TypeTimestamp, emulator.TypeBytes, emulator.TypeText,
		emulator.TypeInteger, emulator.TypeFloat,
	}
	for index, kind := range want {
		if got := result.Columns[index].Type; got != kind {
			t.Errorf("column %s = %v, want %v", result.Columns[index].Name, got, kind)
		}
	}
	if _, ok := result.Rows[0][4].(time.Time); !ok {
		t.Errorf("a declared TIMESTAMP came back as %T", result.Rows[0][4])
	}
}

func TestAColumnThatIsAlwaysNullIsDescribedAsText(t *testing.T) {
	executor := open(t, newBackend(t, "CREATE TABLE t (id INT)", "INSERT INTO t VALUES (1)"))

	result := run(t, executor, "SELECT NULL AS blank FROM t")

	if result.Columns[0].Type != emulator.TypeText {
		t.Errorf("type = %v, want text: there is no evidence of anything else", result.Columns[0].Type)
	}
}

func TestInferredReadsTheTypeOffEveryValueAColumnCanHold(t *testing.T) {
	for name, testCase := range map[string]struct {
		value any
		want  emulator.Type
	}{
		"a Go int":   {7, emulator.TypeInteger},
		"a real":     {1.5, emulator.TypeFloat},
		"some bytes": {[]byte{1}, emulator.TypeBytes},
		"a bool":     {true, emulator.TypeBool},
		"a moment":   {time.Now(), emulator.TypeTimestamp},
		"a string":   {"text", emulator.TypeText},
		"a surprise": {struct{}{}, emulator.TypeText},
	} {
		t.Run(name, func(t *testing.T) {
			if got := inferred(testCase.value); got != testCase.want {
				t.Errorf("inferred(%T) = %v, want %v", testCase.value, got, testCase.want)
			}
		})
	}
}

func TestCloseTakesTheDatabaseWithIt(t *testing.T) {
	backend, err := New()
	if err != nil {
		t.Fatalf("opening: %v", err)
	}
	directory := backend.directory

	if err := backend.Close(); err != nil {
		t.Fatalf("Close = %v", err)
	}
	if _, err := os.Stat(directory); !os.IsNotExist(err) {
		t.Errorf("%s survived the run", directory)
	}
}

func TestABackendThatCannotHandOutConnectionsSaysSo(t *testing.T) {
	backend := newBackend(t)
	if err := backend.pool.Close(); err != nil {
		t.Fatalf("closing the pool: %v", err)
	}

	if _, err := backend.Open(); err == nil {
		t.Error("Open handed out a connection from a closed pool")
	}
}

func TestTranslateNamesTheFailureAPostgresClientWouldRecognise(t *testing.T) {
	executor := open(t, newBackend(t,
		"CREATE TABLE parent (id INT PRIMARY KEY)",
		"CREATE TABLE t (id INT PRIMARY KEY, need INT NOT NULL, positive INT CHECK (positive > 0), parent INT REFERENCES parent(id))",
		"INSERT INTO parent VALUES (1)",
		"INSERT INTO t VALUES (1, 1, 1, 1)",
	))

	for name, testCase := range map[string]struct {
		sql   string
		state string
	}{
		"a duplicate key":        {"INSERT INTO t VALUES (1, 1, 1, 1)", "23505"},
		"a missing value":        {"INSERT INTO t VALUES (2, NULL, 1, 1)", "23502"},
		"a broken check":         {"INSERT INTO t VALUES (3, 1, -1, 1)", "23514"},
		"a missing parent":       {"INSERT INTO t VALUES (4, 1, 1, 99)", "23503"},
		"a table that is not":    {"SELECT * FROM nope", "42P01"},
		"a column that is not":   {"SELECT nope FROM t", "42703"},
		"a function that is not": {"SELECT nope(1)", "42883"},
		"a table twice":          {"CREATE TABLE t (id INT)", "42P07"},
		"a syntax error":         {"SELECT FROM", "42601"},
		"a Postgres cast":        {"SELECT id::text FROM t", "42601"},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := exec(executor, testCase.sql)

			var coded interface{ SQLState() string }
			if !errors.As(err, &coded) {
				t.Fatalf("err = %v, want a failure carrying a SQLSTATE", err)
			}
			if coded.SQLState() != testCase.state {
				t.Errorf("SQLSTATE = %q, want %q (%v)", coded.SQLState(), testCase.state, err)
			}
			if strings.Contains(err.Error(), "SQL logic error") || strings.HasSuffix(err.Error(), ")") {
				t.Errorf("message = %q, want the driver's framing stripped", err.Error())
			}
		})
	}
}

func TestAFailureThatIsNotTheEnginesIsStillGivenACode(t *testing.T) {
	err := translate(errors.New("something else entirely"))

	var coded interface{ SQLState() string }
	if !errors.As(err, &coded) || coded.SQLState() != "XX000" {
		t.Errorf("translate = %v, want an internal_error code", err)
	}
}
