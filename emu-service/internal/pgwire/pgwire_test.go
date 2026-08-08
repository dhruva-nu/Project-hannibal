package pgwire

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/control"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/emulator"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/oplog"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/sqlitedb"
)

// These tests drive the codec with a real Postgres driver over a real socket,
// because the only question that matters about a wire protocol is whether the
// clients that speak it are satisfied. pgx is already a dependency — pgproto3 is
// part of it — so this costs nothing to have.
//
// The listener takes an ephemeral port rather than 5432: this repository's own
// docker-compose publishes that one, and a test suite that cannot run while the
// app is up is a test suite nobody runs.

func serve(t *testing.T, seed []string, rules []control.Rule) (string, *oplog.Log) {
	t.Helper()

	backend, err := sqlitedb.New()
	if err != nil {
		t.Fatalf("opening the database: %v", err)
	}
	t.Cleanup(func() { _ = backend.Close() })

	if len(seed) > 0 {
		raw := []byte(`["` + strings.Join(seed, `","`) + `"]`)
		if err := backend.Seed(raw); err != nil {
			t.Fatalf("seeding: %v", err)
		}
	}

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

// connect drives emu the way psycopg and node-postgres do: Parse, Bind, describe
// the *portal*, Execute. pgx's own default instead asks what a prepared statement
// returns before binding it, which emu has no planner to answer — see
// TestEmuSaysItCannotDescribeAStatementItHasNotRun.
func connectionString(address string) string {
	host, port, _ := net.SplitHostPort(address)
	return fmt.Sprintf("postgres://app@%s:%s/app?sslmode=prefer", host, port)
}

func connect(t *testing.T, address string) *pgx.Conn {
	t.Helper()

	config, err := pgx.ParseConfig(connectionString(address))
	if err != nil {
		t.Fatalf("parsing the connection string: %v", err)
	}
	config.DefaultQueryExecMode = pgx.QueryExecModeExec

	conn, err := pgx.ConnectConfig(context.Background(), config)
	if err != nil {
		t.Fatalf("connecting: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close(context.Background()) })
	return conn
}

func TestADriverConnectsAndReadsRowsWithNoShim(t *testing.T) {
	address, _ := serve(t, []string{
		"CREATE TABLE accounts (id INT PRIMARY KEY, balance INT, name TEXT, active BOOLEAN, ratio REAL, opened TIMESTAMP)",
		"INSERT INTO accounts VALUES (1, 100, 'ada', 1, 0.5, '2024-01-02 03:04:05'), (2, 50, NULL, 0, 1.25, NULL)",
	}, nil)
	conn := connect(t, address)

	rows, err := conn.Query(context.Background(), "SELECT id, balance, name, active, ratio, opened FROM accounts ORDER BY id")
	if err != nil {
		t.Fatalf("querying: %v", err)
	}
	defer rows.Close()

	var id, balance int64
	var name *string
	var active bool
	var ratio float64
	var opened *time.Time
	if !rows.Next() {
		t.Fatalf("no rows: %v", rows.Err())
	}

	fields := rows.FieldDescriptions()
	wantOIDs := []uint32{oidInt8, oidInt8, oidText, oidBool, oidFloat8, oidTimestamp}
	for index, want := range wantOIDs {
		if fields[index].DataTypeOID != want {
			t.Errorf("%s is OID %d, want %d", fields[index].Name, fields[index].DataTypeOID, want)
		}
	}
	if err := rows.Scan(&id, &balance, &name, &active, &ratio, &opened); err != nil {
		t.Fatalf("scanning: %v", err)
	}
	if id != 1 || balance != 100 || *name != "ada" || !active || ratio != 0.5 || opened.Year() != 2024 {
		t.Errorf("row = %d %d %v %v %v %v, want the seeded values", id, balance, name, active, ratio, opened)
	}

	if !rows.Next() {
		t.Fatalf("only one row: %v", rows.Err())
	}
	if err := rows.Scan(&id, &balance, &name, &active, &ratio, &opened); err != nil {
		t.Fatalf("scanning: %v", err)
	}
	if name != nil || active || opened != nil {
		t.Errorf("NULLs came back as %v %v %v", name, active, opened)
	}
}

func TestParametersSurviveTheExtendedProtocol(t *testing.T) {
	address, _ := serve(t, []string{
		"CREATE TABLE t (id INT, name TEXT)",
		"INSERT INTO t VALUES (1, 'a'), (2, 'b')",
	}, nil)
	conn := connect(t, address)

	var name string
	err := conn.QueryRow(context.Background(), "SELECT name FROM t WHERE id = $1", 2).Scan(&name)

	if err != nil || name != "b" {
		t.Errorf("name = %q, err = %v, want the parameterised row", name, err)
	}
}

func TestTagsCarryTheCountsADriverReportsAsRowsAffected(t *testing.T) {
	address, _ := serve(t, []string{"CREATE TABLE t (id INT)"}, nil)
	conn := connect(t, address)

	for _, step := range []struct {
		sql  string
		tag  string
		rows int64
	}{
		{"INSERT INTO t VALUES (1), (2)", "INSERT 0 2", 2},
		{"UPDATE t SET id = id + 1", "UPDATE 2", 2},
		{"DELETE FROM t", "DELETE 2", 2},
		{"CREATE TABLE later (x INT)", "CREATE TABLE", 0},
	} {
		tag, err := conn.Exec(context.Background(), step.sql)
		if err != nil {
			t.Fatalf("%s: %v", step.sql, err)
		}
		if tag.String() != step.tag || tag.RowsAffected() != step.rows {
			t.Errorf("%s -> %q (%d rows), want %q (%d)", step.sql, tag.String(), tag.RowsAffected(), step.tag, step.rows)
		}
	}
}

func TestOneQueryMayCarrySeveralStatementsAndEachIsItsOwnOperation(t *testing.T) {
	address, log := serve(t, []string{"CREATE TABLE t (id INT)"}, nil)
	conn := connect(t, address)

	// The simple protocol is what a driver uses when there is nothing to bind.
	if _, err := conn.Exec(context.Background(), "INSERT INTO t VALUES (1); INSERT INTO t VALUES (2)"); err != nil {
		t.Fatalf("multi-statement query: %v", err)
	}

	var count int
	if err := conn.QueryRow(context.Background(), "SELECT count(*) FROM t").Scan(&count); err != nil {
		t.Fatalf("counting: %v", err)
	}
	if count != 2 {
		t.Errorf("count = %d, want both statements to have run", count)
	}

	inserts := 0
	for _, entry := range log.Entries() {
		if entry.Op == "INSERT" {
			inserts++
		}
	}
	if inserts != 2 {
		t.Errorf("op log holds %d inserts, want one per statement", inserts)
	}
}

func TestAnEmptyQueryIsAnsweredRatherThanIgnored(t *testing.T) {
	address, _ := serve(t, []string{"CREATE TABLE t (id INT)"}, nil)
	conn := connect(t, address)

	if _, err := conn.Exec(context.Background(), " "); err != nil {
		t.Errorf("an empty query = %v, want it answered", err)
	}
	if _, err := conn.Exec(context.Background(), "SELECT 1"); err != nil {
		t.Errorf("the connection did not survive an empty query: %v", err)
	}
}

func TestAFaultedCommitFailsTheWayARealSerializationFailureDoes(t *testing.T) {
	address, log := serve(t,
		[]string{
			"CREATE TABLE accounts (id INT PRIMARY KEY, balance INT)",
			"INSERT INTO accounts VALUES (1, 100)",
		},
		[]control.Rule{{
			Match: "postgres.COMMIT", After: 2, Times: 1, Action: control.ActionError,
			Message: "could not serialize access due to concurrent update",
		}},
	)
	conn := connect(t, address)
	ctx := context.Background()

	var failure *pgconn.PgError
	for transfer := range 3 {
		tx, err := conn.Begin(ctx)
		if err != nil {
			t.Fatalf("transfer %d: begin: %v", transfer, err)
		}
		if _, err := tx.Exec(ctx, "UPDATE accounts SET balance = balance - 10 WHERE id = 1"); err != nil {
			t.Fatalf("transfer %d: update: %v", transfer, err)
		}
		if err := tx.Commit(ctx); err != nil && !errors.As(err, &failure) {
			t.Fatalf("transfer %d: commit: %v", transfer, err)
		}
	}

	if failure == nil {
		t.Fatal("no commit failed, want the third one to")
	}
	if failure.Code != "40001" {
		t.Errorf("SQLSTATE = %q, want 40001 so a driver knows to retry", failure.Code)
	}
	if failure.Message != "could not serialize access due to concurrent update" {
		t.Errorf("message = %q, want the rule's", failure.Message)
	}

	// The exception is the easy half. The transaction's writes being gone is the
	// half a lesson is actually about.
	var balance int
	if err := conn.QueryRow(ctx, "SELECT balance FROM accounts WHERE id = 1").Scan(&balance); err != nil {
		t.Fatalf("reading the balance: %v", err)
	}
	if balance != 80 {
		t.Errorf("balance = %d, want 80: the faulted transaction must have left nothing behind", balance)
	}

	faulted := 0
	for _, entry := range log.Entries() {
		if entry.Fault != "" {
			faulted++
			if entry.Op != "COMMIT" {
				t.Errorf("the fault landed on %s, want COMMIT", entry.Op)
			}
		}
	}
	if faulted != 1 {
		t.Errorf("%d operations were faulted, want exactly one", faulted)
	}
}

func TestARuleMayNameTheFailureItWantsAClientToSee(t *testing.T) {
	address, _ := serve(t, []string{"CREATE TABLE t (id INT)"}, []control.Rule{{
		Match: "postgres.SELECT", Action: control.ActionError,
		Message: "too many connections", Code: "53300",
	}})
	conn := connect(t, address)

	_, err := conn.Exec(context.Background(), "SELECT id FROM t")

	var failure *pgconn.PgError
	if !errors.As(err, &failure) || failure.Code != "53300" {
		t.Errorf("err = %v, want the rule's own SQLSTATE", err)
	}
}

func TestADroppedConnectionLooksLikeADeadSocket(t *testing.T) {
	address, _ := serve(t, []string{"CREATE TABLE t (id INT)"}, []control.Rule{
		{Match: "postgres.SELECT", Action: control.ActionDropConn},
	})
	conn := connect(t, address)

	_, err := conn.Exec(context.Background(), "SELECT id FROM t")

	var failure *pgconn.PgError
	if err == nil || errors.As(err, &failure) {
		t.Errorf("err = %v, want a broken connection rather than a protocol error", err)
	}
}

func TestARefusedConnectionNeverBecomesAUsableOne(t *testing.T) {
	address, _ := serve(t, nil, []control.Rule{{
		Match: "postgres.CONNECT", Action: control.ActionError, Message: "sorry, too many clients already",
	}})

	_, err := pgx.Connect(context.Background(), connectionString(address))

	if err == nil || !strings.Contains(err.Error(), "too many clients") {
		t.Errorf("err = %v, want the connection refused with the rule's reason", err)
	}
}

func TestConnectCarriesTheGaugeARuleGatesOn(t *testing.T) {
	address, log := serve(t, nil, []control.Rule{{
		Match: "postgres.CONNECT", Action: control.ActionError,
		When: control.Conditions{"connections_gte": 1},
	}})
	first := connect(t, address)

	if _, err := pgx.Connect(context.Background(), connectionString(address)); err == nil {
		t.Error("a second connection was allowed while one was already open")
	}
	_ = first.Close(context.Background())

	if len(log.Entries()) != 2 {
		t.Errorf("op log = %#v, want both connection attempts recorded", log.Entries())
	}
}

func TestABackendFailureReachesTheClientWithItsOwnCode(t *testing.T) {
	address, _ := serve(t, []string{"CREATE TABLE t (id INT PRIMARY KEY)", "INSERT INTO t VALUES (1)"}, nil)
	conn := connect(t, address)

	_, err := conn.Exec(context.Background(), "INSERT INTO t VALUES (1)")

	var failure *pgconn.PgError
	if !errors.As(err, &failure) || failure.Code != "23505" {
		t.Errorf("err = %v, want a unique violation", err)
	}
	if _, err := conn.Exec(context.Background(), "SELECT id FROM t"); err != nil {
		t.Errorf("the connection did not survive a failed statement: %v", err)
	}
}

func TestATransactionThatFailedRefusesEverythingUntilItEnds(t *testing.T) {
	address, _ := serve(t, []string{"CREATE TABLE t (id INT)"}, nil)
	conn := connect(t, address)
	ctx := context.Background()

	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	if _, err := tx.Exec(ctx, "SELECT id FROM nope"); err == nil {
		t.Fatal("a missing table did not fail")
	}

	_, err = tx.Exec(ctx, "SELECT id FROM t")

	var failure *pgconn.PgError
	if !errors.As(err, &failure) || failure.Code != "25P02" {
		t.Errorf("err = %v, want the block refused until it ends", err)
	}
	if err := tx.Rollback(ctx); err != nil {
		t.Fatalf("rollback: %v", err)
	}
	if _, err := conn.Exec(ctx, "SELECT id FROM t"); err != nil {
		t.Errorf("the connection is still refusing after the rollback: %v", err)
	}
}

func TestANamedStatementIsParsedOnceAndExecutedMany(t *testing.T) {
	address, log := serve(t, []string{"CREATE TABLE t (id INT)", "INSERT INTO t VALUES (1), (2), (3)"}, nil)
	conn := connect(t, address)
	ctx := context.Background()

	if _, err := conn.PgConn().Prepare(ctx, "counter", "SELECT count(*) FROM t WHERE id > $1", nil); err != nil {
		t.Fatalf("preparing: %v", err)
	}

	for round := range 3 {
		result := conn.PgConn().ExecPrepared(ctx, "counter", [][]byte{[]byte("1")}, nil, nil).Read()
		if result.Err != nil {
			t.Fatalf("round %d: %v", round, result.Err)
		}
		if len(result.Rows) != 1 || string(result.Rows[0][0]) != "2" {
			t.Errorf("round %d: rows = %q, want one row holding 2", round, result.Rows)
		}
		if len(result.FieldDescriptions) != 1 {
			t.Errorf("round %d: the portal was not described: %#v", round, result.FieldDescriptions)
		}
	}

	if err := conn.PgConn().Deallocate(ctx, "counter"); err != nil {
		t.Fatalf("deallocating: %v", err)
	}

	for _, entry := range log.Entries() {
		if entry.Op == "QUERY" {
			t.Errorf("the driver's own bookkeeping reached the op log: %#v", entry)
		}
	}
}

func TestEmuSaysItCannotDescribeAStatementItHasNotRun(t *testing.T) {
	// A statement's result shape is something a planner knows and emu does not:
	// SQLite only reports a query's columns by running it, and running a client's
	// statement to answer a question about it is not something a server may do.
	// The portal's own Describe carries the columns instead, which is what psycopg
	// and node-postgres ask for and what libpq sends on every ExecPrepared.
	address, _ := serve(t, []string{"CREATE TABLE t (id INT)"}, nil)
	conn := connect(t, address)

	described, err := conn.PgConn().Prepare(context.Background(), "shape", "SELECT id FROM t WHERE id = $1", nil)

	if err != nil {
		t.Fatalf("preparing: %v", err)
	}
	if len(described.ParamOIDs) != 1 || described.ParamOIDs[0] != oidText {
		t.Errorf("ParamOIDs = %v, want the type emu resolves an unstated parameter to", described.ParamOIDs)
	}
	if len(described.Fields) != 0 {
		t.Errorf("Fields = %#v, want emu to say it does not know", described.Fields)
	}
}

func TestTheDriversOwnStatementsAreAnsweredWithoutReachingTheEngine(t *testing.T) {
	address, log := serve(t, []string{"CREATE TABLE t (id INT)"}, nil)
	conn := connect(t, address)
	ctx := context.Background()

	for _, sql := range []string{"DEALLOCATE ALL", "DISCARD ALL", "DEALLOCATE ALL; SELECT 1"} {
		if _, err := conn.Exec(ctx, sql); err != nil {
			t.Errorf("%s: %v", sql, err)
		}
	}

	for _, entry := range log.Entries() {
		if entry.Op == "QUERY" {
			t.Errorf("%q reached the engine, want pgwire to answer it", entry.Op)
		}
	}
}

func TestAProtocolMistakeIsRefusedWithoutEndingTheConnection(t *testing.T) {
	address, _ := serve(t, []string{"CREATE TABLE t (id INT)"}, nil)
	conn := connect(t, address)
	ctx := context.Background()

	err := conn.PgConn().ExecPrepared(ctx, "never-parsed", nil, nil, nil).Read().Err

	var failure *pgconn.PgError
	if !errors.As(err, &failure) || failure.Code != "26000" {
		t.Errorf("err = %v, want a missing prepared statement reported as 26000", err)
	}
	if _, err := conn.Exec(ctx, "SELECT id FROM t"); err != nil {
		t.Errorf("the connection did not survive the mistake: %v", err)
	}
}

func TestAskingForResultsEmuCannotProduceIsSaidOutLoud(t *testing.T) {
	address, _ := serve(t, []string{"CREATE TABLE t (id INT)"}, nil)
	conn := connect(t, address)
	ctx := context.Background()

	err := conn.PgConn().ExecParams(ctx, "SELECT id FROM t", nil, nil, nil, []int16{1}).Read().Err

	var failure *pgconn.PgError
	if !errors.As(err, &failure) || failure.Code != "0A000" {
		t.Errorf("err = %v, want emu to say it produces text only", err)
	}
}

func TestTerminateEndsTheConnectionCleanly(t *testing.T) {
	address, log := serve(t, []string{"CREATE TABLE t (id INT)"}, nil)

	conn, err := pgx.Connect(context.Background(), connectionString(address))
	if err != nil {
		t.Fatalf("connecting: %v", err)
	}
	if err := conn.Close(context.Background()); err != nil {
		t.Fatalf("closing: %v", err)
	}

	if entries := log.Entries(); len(entries) != 1 || entries[0].Op != emulator.KindConnect {
		t.Errorf("op log = %#v, want just the connection", entries)
	}
}
