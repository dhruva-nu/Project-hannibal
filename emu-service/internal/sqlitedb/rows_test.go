package sqlitedb

import (
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/control"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/sqltext"
)

// A brokenRows is a result set that fails where a real one only fails on a
// database that is already coming apart. Naming the failures is what lets the
// handling of them be exercised at all.
type brokenRows struct {
	columnsErr error
	scanErr    error
	iterateErr error
	rows       int
}

func (b *brokenRows) ColumnTypes() ([]*sql.ColumnType, error) { return nil, b.columnsErr }

func (b *brokenRows) Next() bool {
	if b.rows == 0 {
		return false
	}
	b.rows--
	return true
}

func (b *brokenRows) Scan(...any) error { return b.scanErr }

func (b *brokenRows) Err() error { return b.iterateErr }

func TestAResultSetThatComesApartIsReportedRatherThanTruncated(t *testing.T) {
	for name, rows := range map[string]*brokenRows{
		"the columns cannot be described": {columnsErr: errors.New("closed")},
		"a row cannot be read":            {scanErr: errors.New("closed"), rows: 1},
		"the scan stopped early":          {iterateErr: errors.New("closed")},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := collect(rows); err == nil {
				t.Error("collect returned a result from a result set that failed")
			}
		})
	}
}

func TestAQueryThatFailsWhileItIsReadIsReported(t *testing.T) {
	executor := open(t, newBackend(t,
		"CREATE TABLE t (id INT)",
		"INSERT INTO t VALUES (1), (-9223372036854775808)",
	))

	// The first row is fine and the second overflows, so SQLite only discovers
	// this while stepping — the path a failure after the statement was accepted
	// takes, and the one that must not be reported as a short result.
	_, err := exec(executor, "SELECT abs(id) FROM t")

	if err == nil {
		t.Fatal("a query that overflowed halfway was reported as a result")
	}
}

func TestATransactionCannotBeBegunOnAConnectionThatIsGone(t *testing.T) {
	executor := open(t, newBackend(t)).(*connection)
	if err := executor.conn.Close(); err != nil {
		t.Fatalf("closing the connection: %v", err)
	}

	if _, err := executor.Exec(control.Op{Kind: sqltext.KindBegin}); err == nil {
		t.Error("a transaction began on a connection that was already closed")
	}
}

func TestADatabaseThatCannotBeCreatedIsReported(t *testing.T) {
	// A temp directory that is a file, so that creating one inside it cannot work.
	blocked := filepath.Join(t.TempDir(), "not-a-directory")
	if err := os.WriteFile(blocked, nil, 0o600); err != nil {
		t.Fatalf("writing the blocker: %v", err)
	}
	t.Setenv("TMPDIR", blocked)

	if _, err := New(); err == nil || !strings.Contains(err.Error(), "opening the SQL database") {
		t.Errorf("New = %v, want a failure that says what could not be opened", err)
	}
}

func TestStateForFallsBackWhenSQLiteSaysOnlyThatSomethingIsWrong(t *testing.T) {
	for name, testCase := range map[string]struct {
		sql   string
		state string
	}{
		"a constraint with no specific code": {"INSERT INTO strict_table VALUES ('text')", "23000"},
		"a failure with no phrase to go on":  {"SELECT count(1, 2, 3)", "42000"},
	} {
		t.Run(name, func(t *testing.T) {
			executor := open(t, newBackend(t, "CREATE TABLE strict_table (id INTEGER) STRICT"))

			_, err := exec(executor, testCase.sql)

			var coded interface{ SQLState() string }
			if !errors.As(err, &coded) {
				t.Fatalf("err = %v, want a failure carrying a SQLSTATE", err)
			}
			if coded.SQLState() != testCase.state {
				t.Errorf("SQLSTATE = %q, want %q (%v)", coded.SQLState(), testCase.state, err)
			}
		})
	}
}
