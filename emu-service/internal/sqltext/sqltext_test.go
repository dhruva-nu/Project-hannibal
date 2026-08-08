package sqltext

import (
	"reflect"
	"testing"
)

func TestSplitEndsAStatementOnlyAtATopLevelSemicolon(t *testing.T) {
	for name, testCase := range map[string]struct {
		sql  string
		want []string
	}{
		"one statement":            {"SELECT 1", []string{"SELECT 1"}},
		"two statements":           {"SELECT 1; SELECT 2", []string{"SELECT 1", "SELECT 2"}},
		"a trailing semicolon":     {"SELECT 1;", []string{"SELECT 1"}},
		"empty statements between": {";;SELECT 1;;", []string{"SELECT 1"}},
		"nothing at all":           {"   ", nil},
		"a semicolon in a string": {
			`INSERT INTO t VALUES ('a;b'); SELECT 1`,
			[]string{`INSERT INTO t VALUES ('a;b')`, "SELECT 1"},
		},
		"a doubled quote inside a string": {
			`SELECT 'it''s; fine'`,
			[]string{`SELECT 'it''s; fine'`},
		},
		"a semicolon in a quoted identifier": {
			`SELECT "a;b" FROM t`,
			[]string{`SELECT "a;b" FROM t`},
		},
		"a semicolon in a line comment": {
			"SELECT 1 -- ; not a statement\n; SELECT 2",
			[]string{"SELECT 1 -- ; not a statement", "SELECT 2"},
		},
		"a semicolon in a block comment": {
			"SELECT /* ; */ 1; SELECT 2",
			[]string{"SELECT /* ; */ 1", "SELECT 2"},
		},
		"an unterminated string swallows the rest": {
			`SELECT 'oops; SELECT 2`,
			[]string{`SELECT 'oops; SELECT 2`},
		},
		"an unterminated block comment swallows the rest": {
			"SELECT 1 /* ; SELECT 2",
			[]string{"SELECT 1 /* ; SELECT 2"},
		},
		"a line comment with no newline": {"SELECT 1 -- done", []string{"SELECT 1 -- done"}},
	} {
		t.Run(name, func(t *testing.T) {
			if got := Split(testCase.sql); !reflect.DeepEqual(got, testCase.want) {
				t.Errorf("Split(%q) = %#v, want %#v", testCase.sql, got, testCase.want)
			}
		})
	}
}

func TestKindIsWhatAFaultRuleMatchesOn(t *testing.T) {
	for sql, want := range map[string]string{
		"SELECT 1":                      KindSelect,
		"  select 1":                    KindSelect,
		"INSERT INTO t VALUES (1)":      KindInsert,
		"UPDATE t SET a = 1":            KindUpdate,
		"DELETE FROM t":                 KindDelete,
		"BEGIN":                         KindBegin,
		"START TRANSACTION":             KindBegin,
		"COMMIT":                        KindCommit,
		"END":                           KindCommit,
		"ROLLBACK":                      KindRollback,
		"ABORT":                         KindRollback,
		"CREATE TABLE t (a INT)":        KindQuery,
		"WITH x AS (SELECT 1) SELECT 1": KindQuery,
		"":                              KindQuery,
	} {
		if got := Parse(sql, nil).Kind; got != want {
			t.Errorf("Parse(%q).Kind = %q, want %q", sql, got, want)
		}
	}
}

func TestReturnsRowsCoversTheStatementsWithAResultSet(t *testing.T) {
	for sql, want := range map[string]bool{
		"SELECT 1":                              true,
		"WITH x AS (SELECT 1) SELECT * FROM x":  true,
		"VALUES (1), (2)":                       true,
		"TABLE accounts":                        true,
		"PRAGMA table_info(t)":                  true,
		"EXPLAIN SELECT 1":                      true,
		"INSERT INTO t VALUES (1) RETURNING id": true,
		"UPDATE t SET a = 1 RETURNING a":        true,
		"INSERT INTO t VALUES (1)":              false,
		"CREATE TABLE t (a INT)":                false,
		"":                                      false,
	} {
		if got := Parse(sql, nil).ReturnsRows; got != want {
			t.Errorf("Parse(%q).ReturnsRows = %v, want %v", sql, got, want)
		}
	}
}

func TestTableIsBestEffortAndSaysSoBySayingNothing(t *testing.T) {
	for sql, want := range map[string]string{
		"SELECT * FROM accounts":             "accounts",
		"select a from Accounts where a = 1": "Accounts",
		"INSERT INTO accounts VALUES (1)":    "accounts",
		"UPDATE accounts SET a = 1":          "accounts",
		"DELETE FROM accounts":               "accounts",
		"CREATE TABLE accounts (a INT)":      "accounts",
		"SELECT * FROM public.accounts":      "accounts",
		`SELECT * FROM "user table"`:         "user table",
		`SELECT * FROM "quoted""name"`:       `quoted"name`,
		"SELECT 1":                           "",
		"SELECT * FROM":                      "",
		"SELECT * FROM (SELECT 1)":           "",
		"":                                   "",
	} {
		if got := Parse(sql, nil).Table; got != want {
			t.Errorf("Parse(%q).Table = %q, want %q", sql, got, want)
		}
	}
}

func TestCommandIsWhatPostgresCallsTheStatement(t *testing.T) {
	for sql, want := range map[string]string{
		"CREATE TABLE t (a INT)":  "CREATE TABLE",
		"drop index i":            "DROP INDEX",
		"ALTER TABLE t ADD b INT": "ALTER TABLE",
		"CREATE (":                "CREATE",
		"VACUUM":                  "VACUUM",
		"DEALLOCATE ALL":          "DEALLOCATE",
		"SELECT 1":                "SELECT",
		"":                        "",
	} {
		if got := Parse(sql, nil).Command; got != want {
			t.Errorf("Parse(%q).Command = %q, want %q", sql, got, want)
		}
	}
}

func TestParametersReachTheBackendUntouched(t *testing.T) {
	statement := Parse("SELECT $1", []any{int64(7)})

	if !reflect.DeepEqual(statement.Params, []any{int64(7)}) {
		t.Errorf("Params = %#v, want the values handed in", statement.Params)
	}
}

func TestPlaceholdersAreRewrittenIntoTheSpellingSQLiteBindsByPosition(t *testing.T) {
	for sql, want := range map[string]string{
		"SELECT $1":              "SELECT ?1",
		"SELECT $1 WHERE a = $1": "SELECT ?1 WHERE a = ?1",
		"SELECT $10, $2":         "SELECT ?10, ?2",
		"SELECT $1::text":        "SELECT ?1::text",
		"SELECT 1":               "SELECT 1",
		"SELECT '$1'":            "SELECT '$1'",
		`SELECT "$1" FROM t`:     `SELECT "$1" FROM t`,
		"SELECT $tag$body$tag$":  "SELECT $tag$body$tag$",
		"SELECT $":               "SELECT $",
	} {
		if got := Parse(sql, nil).SQL; got != want {
			t.Errorf("Parse(%q).SQL = %q, want %q", sql, got, want)
		}
	}
}
