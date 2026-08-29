// Package sqltext reads just enough of a SQL statement to route it: where one
// statement ends and the next begins, which operation it is, what it acts on,
// and whether it produces rows.
//
// It is not a parser and does not try to be. Every answer comes from the leading
// keywords plus a scan that knows only about quotes and comments, which is what
// "fail the third INSERT" needs and no more. Where it cannot tell, it answers
// empty rather than guessing.
package sqltext

import "strings"

// The operations a statement can be, in the vocabulary a fault rule matches
// against: "postgres.COMMIT". Anything unrecognised is KindQuery, so a lesson
// that wants all of them still writes "postgres.*".
const (
	KindSelect   = "SELECT"
	KindInsert   = "INSERT"
	KindUpdate   = "UPDATE"
	KindDelete   = "DELETE"
	KindBegin    = "BEGIN"
	KindCommit   = "COMMIT"
	KindRollback = "ROLLBACK"
	KindQuery    = "QUERY"
)

// verbs maps a statement's first word to the kind a rule matches on. Postgres
// and SQLite both spell some of these more than one way.
var verbs = map[string]string{
	"select":   KindSelect,
	"insert":   KindInsert,
	"update":   KindUpdate,
	"delete":   KindDelete,
	"begin":    KindBegin,
	"start":    KindBegin,
	"commit":   KindCommit,
	"end":      KindCommit,
	"rollback": KindRollback,
	"abort":    KindRollback,
}

// rowProducers are the first words that mean "expect a result set". Anything
// else produces rows only by asking for them with RETURNING.
var rowProducers = map[string]bool{
	"select":  true,
	"with":    true,
	"values":  true,
	"table":   true,
	"pragma":  true,
	"explain": true,
}

// twoWordCommands are the statements Postgres names with two words in a command
// tag: it answers "CREATE TABLE", not "CREATE".
var twoWordCommands = map[string]bool{"create": true, "drop": true, "alter": true}

// namesTable are the keywords a table name follows in the statements a lesson
// writes.
var namesTable = map[string]bool{"from": true, "into": true, "update": true, "table": true}

// A Statement is one SQL statement, read once. The protocol that decoded it and
// the backend that runs it need the same answers about it, and scanning it once
// per question would be the same scan four times.
type Statement struct {
	// SQL is the statement as the backend will run it: what the client wrote,
	// with its placeholders in the spelling SQLite binds by position.
	SQL string
	// Params are the values bound to it, already decoded out of the wire format.
	Params []any
	// Kind is the operation a fault rule matches on.
	Kind string
	// Table is the table the statement plainly names, for the op log. Empty when
	// the statement does not obviously name one.
	Table string
	// ReturnsRows is whether the backend should expect a result set.
	ReturnsRows bool
	// Command is what a client is told the statement did when there is no row
	// count to report: "CREATE TABLE".
	Command string
	// Parameters is how many the statement takes, read off its highest $N. A
	// server with a planner would infer this; counting the placeholders is the
	// same answer for every statement a client can actually write.
	Parameters int
}

// Parse reads sql once and answers everything the emulators ask about it.
func Parse(sql string, params []any) Statement {
	words := tokenize(sql)
	return Statement{
		SQL:         bindable(sql),
		Params:      params,
		Kind:        kindOf(words),
		Table:       tableOf(words),
		ReturnsRows: returnsRows(words),
		Command:     commandOf(words),
		Parameters:  countPlaceholders(sql),
	}
}

// Split separates a client's query string into the statements it holds. A
// semicolon inside a string literal, a quoted identifier, or a comment does not
// end a statement, which is the only reason this needs a scanner at all.
func Split(sql string) []string {
	var statements []string

	start := 0
	for _, word := range tokenize(sql) {
		if word.text != ";" {
			continue
		}
		statements = appendStatement(statements, sql[start:word.at])
		start = word.at + 1
	}
	return appendStatement(statements, sql[start:])
}

func appendStatement(statements []string, text string) []string {
	if trimmed := strings.TrimSpace(text); trimmed != "" {
		return append(statements, trimmed)
	}
	return statements
}

func kindOf(words []word) string {
	if len(words) == 0 {
		return KindQuery
	}
	if kind, known := verbs[words[0].text]; known {
		return kind
	}
	return KindQuery
}

func returnsRows(words []word) bool {
	if len(words) == 0 {
		return false
	}
	if rowProducers[words[0].text] {
		return true
	}
	for _, word := range words {
		if word.text == "returning" {
			return true
		}
	}
	return false
}

func commandOf(words []word) string {
	if len(words) == 0 {
		return ""
	}
	tag := strings.ToUpper(words[0].text)
	if len(words) > 1 && twoWordCommands[words[0].text] && words[1].name {
		return tag + " " + strings.ToUpper(words[1].text)
	}
	return tag
}

// tableOf takes the name after the first keyword that introduces one. A
// schema-qualified name reads as its last part, because "public.accounts" and
// "accounts" are the same table to a lesson.
func tableOf(words []word) string {
	for index, word := range words {
		if !namesTable[word.text] || index+1 >= len(words) || !words[index+1].name {
			continue
		}
		return qualified(words[index+1:])
	}
	return ""
}

func qualified(words []word) string {
	name := words[0].raw
	for len(words) >= 3 && words[1].text == "." && words[2].name {
		name = words[2].raw
		words = words[2:]
	}
	return name
}
