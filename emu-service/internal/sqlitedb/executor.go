package sqlitedb

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/control"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/emulator"
	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/sqltext"
)

// abortedTransaction is what Postgres answers for every statement between a
// failure inside a transaction block and the ROLLBACK that ends it. SQLite would
// happily carry on, and a lesson about error handling depends on the difference.
var abortedTransaction = &sqlError{
	code:    "25P02",
	message: "current transaction is aborted, commands ignored until end of transaction block",
}

// runner is the half of *sql.Conn and *sql.Tx that executing a statement needs,
// so that a statement inside a transaction and one outside take the same path.
type runner interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

// A connection runs one client connection's statements. Its transaction is its
// own: two sessions each inside a transaction must not see each other's writes
// before they commit, which is the entire reason a connection gets one of these
// rather than sharing the pool.
type connection struct {
	conn   *sql.Conn
	tx     *sql.Tx
	failed bool
}

func (c *connection) Exec(op control.Op) (emulator.Result, error) {
	switch op.Kind {
	case emulator.KindConnect:
		return emulator.Result{}, nil
	case sqltext.KindBegin:
		return c.begin()
	case sqltext.KindCommit:
		return c.commit()
	case sqltext.KindRollback:
		return c.rollback()
	}

	statement, ok := op.Payload.(sqltext.Statement)
	if !ok {
		return emulator.Result{}, fmt.Errorf("the SQL backend was handed a %s with no statement", op.Kind)
	}
	return c.run(statement)
}

// Abort undoes what the control layer would not let happen. A faulted COMMIT has
// to leave the transaction's writes absent — an exception the student can catch
// while the rows landed anyway teaches the opposite of the lesson.
func (c *connection) Abort(op control.Op) {
	switch op.Kind {
	case sqltext.KindCommit, sqltext.KindRollback:
		c.discard()
	default:
		// An interrupted statement poisons the transaction it was inside, exactly
		// as a statement the server itself rejected would.
		c.failed = c.tx != nil
	}
}

func (c *connection) Close() error {
	c.discard()
	return c.conn.Close()
}

func (c *connection) begin() (emulator.Result, error) {
	if c.tx != nil {
		// Postgres warns and carries on rather than failing the client.
		return emulator.Result{Tag: sqltext.KindBegin}, nil
	}
	tx, err := c.conn.BeginTx(context.Background(), nil)
	if err != nil {
		return emulator.Result{}, translate(err)
	}
	c.tx, c.failed = tx, false
	return emulator.Result{Tag: sqltext.KindBegin}, nil
}

// commit ends the transaction whichever way it has to. Postgres answers ROLLBACK
// to a COMMIT of a transaction that already failed, and the client is entitled to
// believe that tag.
func (c *connection) commit() (emulator.Result, error) {
	switch {
	case c.tx == nil:
		return emulator.Result{Tag: sqltext.KindCommit}, nil
	case c.failed:
		c.discard()
		return emulator.Result{Tag: sqltext.KindRollback}, nil
	}

	err := c.tx.Commit()
	c.tx, c.failed = nil, false
	if err != nil {
		return emulator.Result{}, translate(err)
	}
	return emulator.Result{Tag: sqltext.KindCommit}, nil
}

func (c *connection) rollback() (emulator.Result, error) {
	c.discard()
	return emulator.Result{Tag: sqltext.KindRollback}, nil
}

// discard throws the open transaction away. A rollback that fails has still
// ended the transaction — database/sql keeps no half-open Tx and the writes are
// not going anywhere — and if the connection underneath it is broken, the next
// statement says so with something a client can act on.
func (c *connection) discard() {
	c.failed = false
	if c.tx == nil {
		return
	}
	_ = c.tx.Rollback()
	c.tx = nil
}

func (c *connection) run(statement sqltext.Statement) (emulator.Result, error) {
	if c.failed {
		return emulator.Result{}, abortedTransaction
	}
	if statement.ReturnsRows {
		return c.query(statement)
	}

	outcome, err := c.runner().ExecContext(context.Background(), statement.SQL, statement.Params...)
	if err != nil {
		return emulator.Result{}, c.reject(err)
	}
	// modernc.org/sqlite always knows how many rows it touched. The error exists
	// for drivers that do not, and zero is the only thing left to say.
	affected, _ := outcome.RowsAffected()
	return emulator.Result{Tag: tag(statement, affected)}, nil
}

func (c *connection) query(statement sqltext.Statement) (emulator.Result, error) {
	rows, err := c.runner().QueryContext(context.Background(), statement.SQL, statement.Params...)
	if err != nil {
		return emulator.Result{}, c.reject(err)
	}
	defer func() { _ = rows.Close() }()

	result, err := collect(rows)
	if err != nil {
		return emulator.Result{}, c.reject(err)
	}
	result.Tag = tag(statement, int64(len(result.Rows)))
	return result, nil
}

// reject records that a statement failed inside a transaction, which is what
// makes every later statement in the block fail too.
func (c *connection) reject(err error) error {
	c.failed = c.tx != nil
	return translate(err)
}

func (c *connection) runner() runner {
	if c.tx != nil {
		return c.tx
	}
	return c.conn
}
