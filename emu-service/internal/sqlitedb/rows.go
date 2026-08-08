package sqlitedb

import (
	"database/sql"
	"strings"
	"time"

	"github.com/dhruva-nu/Project-hannibal/emu-service/internal/emulator"
)

// A resultSet is the part of *sql.Rows that reading a result needs. Naming it
// keeps collect honest about what it touches, and lets the failures a real query
// almost never produces be exercised anyway.
type resultSet interface {
	ColumnTypes() ([]*sql.ColumnType, error)
	Next() bool
	Scan(...any) error
	Err() error
}

// declaredTypes maps what a SQLite column was declared as onto what the result
// is. SQLite is dynamically typed and a column's declaration is only an affinity,
// but it is the closest thing to an intention the schema records — and it is the
// only reason a column declared BOOLEAN can reach a client as true rather than 1.
var declaredTypes = []struct {
	spelling string
	kind     emulator.Type
}{
	{"BOOL", emulator.TypeBool},
	{"INT", emulator.TypeInteger},
	{"CHAR", emulator.TypeText},
	{"CLOB", emulator.TypeText},
	{"TEXT", emulator.TypeText},
	{"BLOB", emulator.TypeBytes},
	{"REAL", emulator.TypeFloat},
	{"FLOA", emulator.TypeFloat},
	{"DOUB", emulator.TypeFloat},
	{"DATE", emulator.TypeTimestamp},
	{"TIME", emulator.TypeTimestamp},
}

// collect reads a result set whole. Rows are buffered rather than streamed
// because a protocol has to describe the columns before it sends any of them, and
// an expression column has no declared type to describe it by — the values are
// the only evidence there is.
func collect(rows resultSet) (emulator.Result, error) {
	columns, err := rows.ColumnTypes()
	if err != nil {
		return emulator.Result{}, err
	}

	var values [][]any
	for rows.Next() {
		cells := make([]any, len(columns))
		targets := make([]any, len(columns))
		for index := range cells {
			targets[index] = &cells[index]
		}
		if err := rows.Scan(targets...); err != nil {
			return emulator.Result{}, err
		}
		values = append(values, cells)
	}
	if err := rows.Err(); err != nil {
		return emulator.Result{}, err
	}
	return emulator.Result{Columns: describe(columns, values), Rows: values}, nil
}

func describe(columns []*sql.ColumnType, rows [][]any) []emulator.Column {
	described := make([]emulator.Column, len(columns))
	for index, column := range columns {
		described[index] = emulator.Column{
			Name: column.Name(),
			Type: typeOf(column.DatabaseTypeName(), sample(rows, index)),
		}
	}
	return described
}

// sample is the first value a column actually held, which is what an expression
// column has instead of a declaration.
func sample(rows [][]any, index int) any {
	for _, row := range rows {
		if row[index] != nil {
			return row[index]
		}
	}
	return nil
}

func typeOf(declared string, value any) emulator.Type {
	upper := strings.ToUpper(declared)
	for _, candidate := range declaredTypes {
		if strings.Contains(upper, candidate.spelling) {
			return candidate.kind
		}
	}
	return inferred(value)
}

// inferred reads the type off a value, for the columns a schema never described:
// COUNT(*), balance * 2, a literal.
func inferred(value any) emulator.Type {
	switch value.(type) {
	case int64, int:
		return emulator.TypeInteger
	case float64:
		return emulator.TypeFloat
	case bool:
		return emulator.TypeBool
	case []byte:
		return emulator.TypeBytes
	case time.Time:
		return emulator.TypeTimestamp
	default:
		return emulator.TypeText
	}
}
