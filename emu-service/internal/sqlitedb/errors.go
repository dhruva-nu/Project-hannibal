package sqlitedb

import (
	"errors"
	"regexp"
	"strings"

	"modernc.org/sqlite"
)

// A sqlError is a backend failure carrying the SQLSTATE a Postgres client would
// have been given for it. SQLite reports its own result codes, and a driver that
// sees only a message cannot tell a unique violation from a syntax error — which
// is the difference between a lesson's retry loop working and not.
type sqlError struct {
	code    string
	message string
}

func (e *sqlError) Error() string { return e.message }

// SQLState is what the Postgres protocol puts in the error frame's C field.
func (e *sqlError) SQLState() string { return e.code }

// statesByResultCode maps SQLite's extended result codes onto the SQLSTATEs
// Postgres uses for the same failure. Only the codes a lesson can actually
// provoke are listed; everything else falls through to the generic answers.
var statesByResultCode = map[int]string{
	1555: "23505", // SQLITE_CONSTRAINT_PRIMARYKEY -> unique_violation
	2067: "23505", // SQLITE_CONSTRAINT_UNIQUE
	787:  "23503", // SQLITE_CONSTRAINT_FOREIGNKEY -> foreign_key_violation
	1299: "23502", // SQLITE_CONSTRAINT_NOTNULL    -> not_null_violation
	275:  "23514", // SQLITE_CONSTRAINT_CHECK      -> check_violation
	5:    "55P03", // SQLITE_BUSY                  -> lock_not_available
	6:    "55P03", // SQLITE_LOCKED
	8:    "25006", // SQLITE_READONLY -> read_only_sql_transaction
	13:   "53100", // SQLITE_FULL     -> disk_full
	20:   "42804", // SQLITE_MISMATCH -> datatype_mismatch
	25:   "22003", // SQLITE_RANGE    -> numeric_value_out_of_range
}

// constraintFamily is the low byte every SQLITE_CONSTRAINT_* code shares.
const constraintFamily = 19

// statesByPhrase is the only way to tell apart what SQLite lumps into result code
// 1: a missing table, a missing column, and a syntax error all arrive as
// SQLITE_ERROR with nothing but the sentence to go on.
var statesByPhrase = []struct {
	phrase string
	state  string
}{
	{"no such table", "42P01"},          // undefined_table
	{"no such column", "42703"},         // undefined_column
	{"no such function", "42883"},       // undefined_function
	{"already exists", "42P07"},         // duplicate_table
	{"syntax error", "42601"},           // syntax_error
	{"unrecognized token", "42601"},     // what a Postgres-only operator reads as
	{"missing named argument", "42P02"}, // undefined_parameter
}

// resultCodeSuffix is the "(1555)" the driver appends to every message. A student
// reading an error has no use for SQLite's numbering.
var resultCodeSuffix = regexp.MustCompile(` \(\d+\)$`)

// noiseWords are the driver's own framing, stripped so the sentence that reaches
// the student is the one that says what went wrong.
var noiseWords = []string{"SQL logic error: ", "constraint failed: "}

// translate turns a SQLite failure into one a Postgres client can act on.
func translate(err error) error {
	var failure *sqlite.Error
	if !errors.As(err, &failure) {
		return &sqlError{code: "XX000", message: err.Error()}
	}
	return &sqlError{code: stateFor(failure), message: clean(failure.Error())}
}

func stateFor(failure *sqlite.Error) string {
	if state, known := statesByResultCode[failure.Code()]; known {
		return state
	}
	if failure.Code()&0xFF == constraintFamily {
		return "23000" // integrity_constraint_violation
	}

	message := strings.ToLower(failure.Error())
	for _, candidate := range statesByPhrase {
		if strings.Contains(message, candidate.phrase) {
			return candidate.state
		}
	}
	return "42000" // syntax_error_or_access_rule_violation
}

func clean(message string) string {
	message = resultCodeSuffix.ReplaceAllString(message, "")
	for _, noise := range noiseWords {
		message = strings.TrimPrefix(message, noise)
	}
	return message
}
