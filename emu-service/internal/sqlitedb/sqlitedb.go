// Package sqlitedb answers SQL semantics for the emulated SQL database.
//
// The control layer mocks *behaviour* — this commit fails, this query is slow.
// Something still has to evaluate the join, the GROUP BY, the HAVING, because a
// student who writes a wrong query and gets the right answer has no feedback
// loop left. modernc.org/sqlite is a pure-Go library that does that inside emu:
// no CGO, no daemon, no socket, no container. Students see Postgres on 5432 and
// never know it is there.
package sqlitedb

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/emulator"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/sqltext"

	_ "modernc.org/sqlite" // the "sqlite" driver this package opens
)

// driverName is modernc.org/sqlite's registration.
const driverName = "sqlite"

// The database is a file in the temp directory rather than ":memory:", and the
// reason is concurrency rather than durability. SQLite's shared-cache in-memory
// mode is the only in-memory mode two connections can both see, and it has no
// MVCC: a reader waits for a writer's open transaction indefinitely, so a
// student holding a transaction on one connection while reading on another would
// hang until the sandbox timed them out. WAL gives readers a snapshot instead,
// which is the behaviour Postgres has and the lesson describes.
//
// Inside the sandbox the temp directory is a tmpfs, so this is still memory —
// nothing reaches a disk and nothing survives the run.
const (
	fileDSN     = "file:%s?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)"
	databaseDir = "emu-sql"
	databaseTag = "db.sqlite"
)

// A Backend is one emulated SQL database.
type Backend struct {
	pool *sql.DB
	// directory holds the database and its write-ahead log, and is removed whole
	// when the run ends.
	directory string
}

// New opens an empty database. Foreign keys are on, unlike SQLite's default and
// like Postgres, so a lesson's REFERENCES means what it says.
func New() (*Backend, error) {
	directory, err := os.MkdirTemp("", databaseDir)
	if err != nil {
		return nil, fmt.Errorf("opening the SQL database: %w", err)
	}

	// sql.Open fails only when the driver is not registered, which the blank
	// import above rules out, and it never touches the database itself.
	pool, _ := sql.Open(driverName, fmt.Sprintf(fileDSN, filepath.Join(directory, databaseTag)))
	return &Backend{pool: pool, directory: directory}, nil
}

// Seed applies the lesson's SQL statements in order, before any client can
// connect. A statement that fails fails the run: a lesson whose fixture did not
// load would grade students on a database that is not the one it describes.
func (b *Backend) Seed(raw json.RawMessage) error {
	if len(raw) == 0 {
		return nil
	}

	var statements []string
	if err := json.Unmarshal(raw, &statements); err != nil {
		return fmt.Errorf("seed for postgres: want a list of SQL statements: %w", err)
	}
	for index, statement := range statements {
		if _, err := b.pool.ExecContext(context.Background(), statement); err != nil {
			return fmt.Errorf("seed for postgres, statement %d (%s): %w", index+1, statement, err)
		}
	}
	return nil
}

// Open gives one client connection its own SQL connection, so that a transaction
// belongs to the session that began it and to nothing else.
func (b *Backend) Open() (emulator.Executor, error) {
	conn, err := b.pool.Conn(context.Background())
	if err != nil {
		return nil, err
	}
	return &connection{conn: conn}, nil
}

// Close drops the database and everything in it. Nothing persists between runs.
func (b *Backend) Close() error {
	return errors.Join(b.pool.Close(), os.RemoveAll(b.directory))
}

// tag is what a client is told the statement did, in Postgres's own words. It
// carries the row count for the statements that have one, which is where a
// driver reads rowcount from, and INSERT carries an OID nobody has used since it
// stopped being a thing.
func tag(statement sqltext.Statement, rows int64) string {
	count := strconv.FormatInt(rows, 10)
	switch {
	case statement.Kind == sqltext.KindInsert:
		return "INSERT 0 " + count
	case statement.Kind == sqltext.KindSelect:
		return "SELECT " + count
	case statement.Kind == sqltext.KindUpdate, statement.Kind == sqltext.KindDelete:
		return statement.Kind + " " + count
	case statement.ReturnsRows:
		// A CTE or a VALUES list is a SELECT as far as a client is concerned.
		return "SELECT " + count
	default:
		return statement.Command
	}
}
