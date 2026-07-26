//! The SQL surface: what a statement *is* (its verb, the tables it touches) and the
//! handful of rewrites that let Postgres-flavoured SQL run on SQLite.
//!
//! **The subset is a design decision, not an accident** (`plans/infra-emulators.md`
//! §4). We author the lessons, so the rule is: anything the subset does not cover
//! fails loudly with a real SQLSTATE, because a divergence a student can see beats one
//! a grader cannot. Nothing here silently drops a clause.
//!
//! Every scan below respects string literals, quoted identifiers, and comments —
//! splitting a batch on a naive `;` would cut `'a;b'` in half, and rewriting `$1`
//! inside a literal would change what the student wrote.

/// The verb a statement is logged and triggered under. These are the op names, so
/// they are also what a fault rule's `after.op_matches` may name.
pub const VERBS: &[&str] = &[
    "SELECT", "INSERT", "UPDATE", "DELETE", "BEGIN", "COMMIT", "ROLLBACK", "CREATE", "DROP",
    "ALTER", "TRUNCATE", "SET", "RESET", "SHOW", "EXPLAIN",
];

/// Verbs that read. Registered as an op class so a rule can say "on the first read".
pub const READ_VERBS: &[&str] = &["SELECT"];
/// Verbs that write rows — the class the mid-transfer crash arms against.
pub const WRITE_VERBS: &[&str] = &["INSERT", "UPDATE", "DELETE", "TRUNCATE"];
/// Verbs that move the transaction state machine.
pub const TRANSACTION_VERBS: &[&str] = &["BEGIN", "COMMIT", "ROLLBACK"];

/// The verb of a statement that held no SQL at all — an empty query string, which is
/// a real thing clients send and which Postgres answers with `EmptyQueryResponse`.
pub const EMPTY_VERB: &str = "EMPTY";

/// Aliases Postgres accepts for the transaction verbs. Mapped to the canonical verb so
/// a fault rule triggering on `COMMIT` also fires on the `END` a client sent instead.
const VERB_ALIASES: &[(&str, &str)] = &[
    ("START", "BEGIN"),
    ("END", "COMMIT"),
    ("ABORT", "ROLLBACK"),
    ("WITH", "SELECT"),
    ("VALUES", "SELECT"),
    ("TABLE", "SELECT"),
];

/// Split a query string into its statements, respecting literals and comments.
///
/// The simple protocol allows a batch (`BEGIN; UPDATE …; COMMIT`) in one message, and
/// each statement has to become its own op: otherwise the `UPDATE` a fault rule arms
/// against would never appear in the log the grader reads.
pub fn split(sql: &str) -> Vec<String> {
    let mut statements = Vec::new();
    let mut start = 0;
    let mut scan = Scanner::new(sql);
    while let Some((at, byte)) = scan.next_code_byte() {
        if byte == b';' {
            push_statement(&mut statements, &sql[start..at]);
            start = at + 1;
        }
    }
    push_statement(&mut statements, &sql[start..]);
    statements
}

fn push_statement(statements: &mut Vec<String>, text: &str) {
    let trimmed = text.trim();
    if !trimmed.is_empty() {
        statements.push(trimmed.to_string());
    }
}

/// The verb a statement is logged under. An unrecognised leading keyword is returned
/// as itself, upper-cased: it is logged faithfully but is absent from [`VERBS`], so a
/// fault rule naming it is refused at install time rather than never firing.
pub fn verb(sql: &str) -> String {
    let Some(word) = first_keyword(sql) else {
        return EMPTY_VERB.to_string();
    };
    let canonical = VERB_ALIASES
        .iter()
        .find(|(alias, _)| *alias == word)
        .map(|(_, verb)| (*verb).to_string())
        .unwrap_or(word);
    canonical
}

/// The first bare keyword, upper-cased, skipping leading comments and whitespace. A
/// statement that opens with anything else (`(SELECT …)`, a literal) has no verb.
fn first_keyword(sql: &str) -> Option<String> {
    let mut scan = Scanner::new(sql);
    let mut start = None;
    let mut end = 0;
    while let Some((at, byte)) = scan.next_code_byte() {
        match (start, is_word(byte), byte.is_ascii_whitespace()) {
            (None, true, _) => {
                start = Some(at);
                end = at + 1;
            }
            // Leading whitespace is not the absence of a keyword.
            (None, false, true) => continue,
            (None, false, false) => return None,
            (Some(_), true, _) => end = at + 1,
            (Some(_), false, _) => break,
        }
    }
    Some(sql[start?..end].to_uppercase())
}

fn is_word(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

/// The tables a statement names, in the order they appear.
///
/// This is what `params.table` narrows a fault rule against, and what a grader reads
/// to say "the transfer touched `accounts` twice". It is a keyword scan, not a parser:
/// a table is whatever follows `FROM` / `INTO` / `UPDATE` / `JOIN` / `TABLE`. Good
/// enough for narrowing; nothing depends on it for correctness.
pub fn tables(sql: &str) -> Vec<String> {
    const INTRODUCERS: &[&str] = &["FROM", "INTO", "UPDATE", "JOIN", "TABLE"];
    /// Words that may sit between an introducer and the name it introduces
    /// (`CREATE TABLE IF NOT EXISTS t`, `DELETE FROM ONLY t`).
    const SKIPPABLE: &[&str] = &["IF", "NOT", "EXISTS", "ONLY"];

    let tokens = code_tokens(sql);
    let mut found = Vec::new();
    for (index, token) in tokens.iter().enumerate() {
        if !INTRODUCERS.contains(&token.to_uppercase().as_str()) {
            continue;
        }
        let name = tokens[index + 1..]
            .iter()
            .find(|word| !SKIPPABLE.contains(&word.to_uppercase().as_str()));
        // `FROM (subquery)` introduces no table, and punctuation is a token here
        // precisely so that case is visible rather than reading `SELECT` as a name.
        let Some(name) = name.map(|name| name.trim_matches('"')) else {
            continue;
        };
        if name.bytes().all(is_word) && !found.contains(&name.to_string()) {
            found.push(name.to_string());
        }
    }
    found
}

/// Tokens outside literals and comments, in order: bare words, quoted identifiers
/// (quotes kept, so [`tables`] can tell `"order"` from the keyword), and every other
/// non-space byte as a token of its own — `(` has to be visible, or `FROM (SELECT …)`
/// reads as a table called `SELECT`.
fn code_tokens(sql: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut scan = Scanner::new(sql);
    let mut quoted_start: Option<usize> = None;
    while let Some((at, byte)) = scan.next_code_byte() {
        // A quoted identifier arrives one code byte at a time, opening quote included,
        // because `Scanner` only hides *string* literals and comments.
        if byte == b'"' {
            match quoted_start.take() {
                None => {
                    flush(&mut tokens, &mut current);
                    quoted_start = Some(at);
                }
                Some(start) => tokens.push(sql[start..=at].to_string()),
            }
            continue;
        }
        if quoted_start.is_some() {
            continue;
        }
        if is_word(byte) {
            current.push(byte as char);
            continue;
        }
        flush(&mut tokens, &mut current);
        if !byte.is_ascii_whitespace() {
            tokens.push((byte as char).to_string());
        }
    }
    flush(&mut tokens, &mut current);
    tokens
}

fn flush(tokens: &mut Vec<String>, current: &mut String) {
    if !current.is_empty() {
        tokens.push(std::mem::take(current));
    }
}

/// Rewrite Postgres SQL into the SQLite dialect. Four rewrites, each because the two
/// spell one concept differently — never to paper over a missing feature:
///
/// - `$1` → `?1`. Identical semantics; SQLite reserves `$name` for named parameters.
/// - `SERIAL PRIMARY KEY` → `INTEGER PRIMARY KEY AUTOINCREMENT`. `SERIAL` is a default
///   plus a sequence, not a type, so it is the one declaration that cannot survive
///   verbatim (every other type name does — see [`crate::types`]).
/// - `ILIKE` → `LIKE`. SQLite's `LIKE` is already case-insensitive for ASCII.
/// - `now()` and `CURRENT_TIMESTAMP` → a fixed timestamp. A deterministic emulator has
///   no wall clock, so both resolve to [`FIXED_NOW`]; see the README's divergences.
///
/// Anything else reaches SQLite untouched and, if unsupported, comes back as a real
/// SQLSTATE the student can read.
pub fn to_sqlite(sql: &str) -> String {
    let placeholders = rewrite_placeholders(sql);
    let mut out = String::with_capacity(placeholders.len());
    let mut scan = Scanner::new(&placeholders);
    let mut last = 0;
    while let Some((at, _)) = scan.next_code_byte() {
        let tail = &placeholders[at..];
        // The consumed length is what `match_keyword` reports, not the pattern's: one
        // space in a pattern matches any run of whitespace, so `SERIAL\n  PRIMARY KEY`
        // is longer than `SERIAL PRIMARY KEY`. Using the pattern's length here left the
        // tail of the match behind (`… AUTOINCREMENTEY`).
        let Some((matched, replacement)) =
            KEYWORD_REWRITES.iter().find_map(|(keyword, replacement)| {
                match_keyword(tail, keyword).map(|matched| (matched, *replacement))
            })
        else {
            continue;
        };
        if at < last {
            continue;
        }
        out.push_str(&placeholders[last..at]);
        out.push_str(replacement);
        last = at + matched;
    }
    out.push_str(&placeholders[last..]);
    out
}

/// What `now()` and `CURRENT_TIMESTAMP` resolve to, spelled as the SQL literal the
/// rewrite substitutes. A wall clock would make two runs of the same scenario produce
/// different rows, and the op log's determinism guarantee (`plans/infra-emulators.md`
/// §8) is the whole point of the emulator.
pub const FIXED_NOW: &str = "'2024-01-01 00:00:00+00'";

/// Keyword-for-keyword rewrites, applied outside literals and comments only. Longest
/// first, so `CURRENT_TIMESTAMP` is never decided by a shorter match.
const KEYWORD_REWRITES: &[(&str, &str)] = &[
    ("SERIAL PRIMARY KEY", "INTEGER PRIMARY KEY AUTOINCREMENT"),
    ("BIGSERIAL PRIMARY KEY", "INTEGER PRIMARY KEY AUTOINCREMENT"),
    ("CURRENT_TIMESTAMP", FIXED_NOW),
    ("SMALLSERIAL", "INTEGER"),
    ("BIGSERIAL", "INTEGER"),
    ("SERIAL", "INTEGER"),
    ("NOW()", FIXED_NOW),
    ("ILIKE", "LIKE"),
];

/// How many bytes of `text` `keyword` matches, case-insensitively and as whole words,
/// or `None` if it does not. One space in the pattern matches any run of whitespace,
/// so `SERIAL\n  PRIMARY KEY` matches `SERIAL PRIMARY KEY`.
fn match_keyword(text: &str, keyword: &str) -> Option<usize> {
    let bytes = text.as_bytes();
    let mut at = 0;
    for expected in keyword.bytes() {
        if expected == b' ' {
            let start = at;
            while bytes.get(at).is_some_and(u8::is_ascii_whitespace) {
                at += 1;
            }
            if at == start {
                return None;
            }
            continue;
        }
        if !bytes.get(at)?.eq_ignore_ascii_case(&expected) {
            return None;
        }
        at += 1;
    }
    // A keyword ending in `)` is already delimited; otherwise the next byte must not
    // continue the word, so `SERIALISED` is not read as `SERIAL`.
    match keyword.as_bytes().last() {
        Some(b')') => Some(at),
        _ => bytes
            .get(at)
            .is_none_or(|byte| !is_word(*byte))
            .then_some(at),
    }
}

/// Rewrite `$1` to `?1`. Postgres numbers parameters from one and so does SQLite's
/// `?NNN`, so this is a spelling change with no semantics attached. `$$`-quoted bodies
/// are untouched: only a `$` followed by digits is a parameter.
fn rewrite_placeholders(sql: &str) -> String {
    let mut out = String::with_capacity(sql.len());
    let mut scan = Scanner::new(sql);
    let mut last = 0;
    let mut previous_was_dollar = false;
    while let Some((at, byte)) = scan.next_code_byte() {
        let is_placeholder = byte == b'$'
            && !previous_was_dollar
            && sql[at + 1..]
                .bytes()
                .next()
                .is_some_and(|next| next.is_ascii_digit());
        previous_was_dollar = byte == b'$';
        if !is_placeholder {
            continue;
        }
        out.push_str(&sql[last..at]);
        out.push('?');
        last = at + 1;
    }
    out.push_str(&sql[last..]);
    out
}

/// A byte-wise walk over SQL that skips string literals and comments.
///
/// It hides `'…'` (including `''` escapes), `$$…$$` dollar-quoted bodies, `--` line
/// comments and `/* … */` block comments, and yields every other byte with its offset.
/// Every rewrite and every split in this module goes through it, so no rewrite can
/// reach inside a value the student wrote.
struct Scanner<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Scanner<'a> {
    fn new(sql: &'a str) -> Self {
        Scanner {
            bytes: sql.as_bytes(),
            at: 0,
        }
    }

    /// The next byte that is code rather than literal or comment text, with its offset.
    fn next_code_byte(&mut self) -> Option<(usize, u8)> {
        loop {
            let at = self.at;
            let byte = *self.bytes.get(at)?;
            self.at += 1;
            match byte {
                b'\'' => self.skip_quoted(b'\''),
                b'-' if self.peek() == Some(b'-') => self.skip_line_comment(),
                b'/' if self.peek() == Some(b'*') => self.skip_block_comment(),
                b'$' if self.peek() == Some(b'$') => {
                    self.at += 1;
                    self.skip_dollar_body();
                }
                _ => return Some((at, byte)),
            }
        }
    }

    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.at).copied()
    }

    /// Skip to past the closing quote. A doubled quote (`''`) is an escape and does not
    /// close the literal — SQL's only escape mechanism for quotes.
    fn skip_quoted(&mut self, quote: u8) {
        while let Some(byte) = self.peek() {
            self.at += 1;
            if byte != quote {
                continue;
            }
            match self.peek() == Some(quote) {
                true => self.at += 1,
                false => return,
            }
        }
    }

    fn skip_line_comment(&mut self) {
        while let Some(byte) = self.peek() {
            self.at += 1;
            if byte == b'\n' {
                return;
            }
        }
    }

    fn skip_block_comment(&mut self) {
        self.at += 1; // the '*'
        while let Some(byte) = self.peek() {
            self.at += 1;
            if byte == b'*' && self.peek() == Some(b'/') {
                self.at += 1;
                return;
            }
        }
    }

    fn skip_dollar_body(&mut self) {
        while let Some(byte) = self.peek() {
            self.at += 1;
            if byte == b'$' && self.peek() == Some(b'$') {
                self.at += 1;
                return;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_batch_splits_into_one_statement_per_op() {
        assert_eq!(
            split("BEGIN; UPDATE accounts SET balance = 1; COMMIT"),
            vec!["BEGIN", "UPDATE accounts SET balance = 1", "COMMIT"]
        );
        // Trailing separators and blank statements produce nothing.
        assert_eq!(split("SELECT 1;;  ;"), vec!["SELECT 1"]);
        assert!(split("").is_empty());
        assert!(split("   \n ").is_empty());
        // A comment-only query is kept as written; `verb` reads it as EMPTY, which is
        // the `EmptyQueryResponse` Postgres answers with.
        assert_eq!(split("-- just a comment"), vec!["-- just a comment"]);
        assert_eq!(verb("-- just a comment"), EMPTY_VERB);
    }

    /// A naive split on `;` would cut a value in half and run the halves as SQL.
    #[test]
    fn a_semicolon_inside_a_literal_or_comment_does_not_split() {
        assert_eq!(
            split("INSERT INTO t (note) VALUES ('a;b')"),
            vec!["INSERT INTO t (note) VALUES ('a;b')"]
        );
        assert_eq!(
            split("SELECT 1 -- ; not a split\n"),
            vec!["SELECT 1 -- ; not a split"]
        );
        assert_eq!(split("SELECT /* ; */ 1"), vec!["SELECT /* ; */ 1"]);
        assert_eq!(split("SELECT '' ; SELECT 2").len(), 2);
        // A doubled quote escapes rather than closes, so the `;` stays inside.
        assert_eq!(split("SELECT 'it''s; fine'").len(), 1);
    }

    #[test]
    fn a_statements_verb_is_what_the_log_and_a_trigger_name_it() {
        for (sql, expected) in [
            ("select 1", "SELECT"),
            ("  \n INSERT INTO t VALUES (1)", "INSERT"),
            ("update accounts set balance = 1", "UPDATE"),
            ("DELETE FROM t", "DELETE"),
            ("begin", "BEGIN"),
            ("START TRANSACTION", "BEGIN"),
            ("commit", "COMMIT"),
            ("END", "COMMIT"),
            ("rollback", "ROLLBACK"),
            ("ABORT", "ROLLBACK"),
            ("WITH x AS (SELECT 1) SELECT * FROM x", "SELECT"),
            ("VALUES (1)", "SELECT"),
            ("TABLE accounts", "SELECT"),
            ("CREATE TABLE t (id INT)", "CREATE"),
            ("SET client_encoding = 'UTF8'", "SET"),
            ("SHOW server_version", "SHOW"),
            ("-- a comment\nSELECT 1", "SELECT"),
            ("/* lead */ SELECT 1", "SELECT"),
        ] {
            assert_eq!(verb(sql), expected, "{sql}");
        }
        assert_eq!(verb(""), EMPTY_VERB);
        assert_eq!(verb("   "), EMPTY_VERB);
        // A statement that does not start with a word at all.
        assert_eq!(verb("(SELECT 1)"), EMPTY_VERB);
        // Logged faithfully under its own name, and absent from VERBS — so a fault
        // rule naming it is a 400 rather than a rule that never fires.
        assert_eq!(verb("VACUUM"), "VACUUM");
        assert!(!VERBS.contains(&"VACUUM"));
    }

    #[test]
    fn the_tables_a_statement_touches_are_what_a_rule_narrows_on() {
        assert_eq!(tables("SELECT * FROM accounts"), vec!["accounts"]);
        assert_eq!(
            tables("UPDATE accounts SET balance = balance - 1 WHERE id = 1"),
            vec!["accounts"]
        );
        assert_eq!(tables("INSERT INTO ledger (a) VALUES (1)"), vec!["ledger"]);
        assert_eq!(
            tables("SELECT * FROM accounts JOIN ledger ON ledger.account_id = accounts.id"),
            vec!["accounts", "ledger"]
        );
        assert_eq!(tables("CREATE TABLE accounts (id INT)"), vec!["accounts"]);
        assert_eq!(
            tables("CREATE TABLE IF NOT EXISTS accounts (id INT)"),
            vec!["accounts"]
        );
        assert_eq!(tables("DELETE FROM ONLY accounts"), vec!["accounts"]);
        assert_eq!(tables("SELECT \"from\" FROM \"order\""), vec!["order"]);
        // A duplicate mention is one table.
        assert_eq!(
            tables("SELECT * FROM accounts WHERE id IN (SELECT id FROM accounts)"),
            vec!["accounts"]
        );
        // Nothing that is not a bare identifier is taken as a table name.
        assert_eq!(tables("SELECT * FROM (SELECT 1)"), Vec::<String>::new());
        assert_eq!(tables("SELECT 1"), Vec::<String>::new());
        assert_eq!(tables("BEGIN"), Vec::<String>::new());
        // A literal cannot introduce a table.
        assert_eq!(tables("SELECT 'from accounts'"), Vec::<String>::new());
    }

    #[test]
    fn placeholders_are_renumbered_into_sqlites_spelling() {
        assert_eq!(
            to_sqlite("UPDATE accounts SET balance = $2 WHERE id = $1"),
            "UPDATE accounts SET balance = ?2 WHERE id = ?1"
        );
        assert_eq!(to_sqlite("SELECT $10"), "SELECT ?10");
        // A `$` that is not a parameter is left alone.
        assert_eq!(to_sqlite("SELECT 'a$1b'"), "SELECT 'a$1b'");
        assert_eq!(to_sqlite("SELECT $$a$1b$$"), "SELECT $$a$1b$$");
        assert_eq!(to_sqlite("SELECT 'cost $'"), "SELECT 'cost $'");
    }

    #[test]
    fn serial_becomes_an_autoincrementing_integer_key() {
        assert_eq!(
            to_sqlite("CREATE TABLE t (id SERIAL PRIMARY KEY, b NUMERIC(12,2))"),
            "CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, b NUMERIC(12,2))"
        );
        assert_eq!(
            to_sqlite("CREATE TABLE t (id bigserial primary key)"),
            "CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT)"
        );
        // Extra whitespace between the keywords is still the same declaration.
        assert_eq!(
            to_sqlite("CREATE TABLE t (id SERIAL\n  PRIMARY KEY)"),
            "CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT)"
        );
        // A SERIAL that is not a key is just an integer.
        assert_eq!(
            to_sqlite("CREATE TABLE t (n SERIAL, m SMALLSERIAL, o BIGSERIAL)"),
            "CREATE TABLE t (n INTEGER, m INTEGER, o INTEGER)"
        );
        // Every other type name survives verbatim — that is what makes the lesson's
        // own DDL the type manifest.
        let untouched = "CREATE TABLE t (a TIMESTAMPTZ, b BOOLEAN, c VARCHAR(40), d JSONB)";
        assert_eq!(to_sqlite(untouched), untouched);
    }

    #[test]
    fn the_remaining_rewrites_are_spelling_only() {
        assert_eq!(
            to_sqlite("SELECT * FROM t WHERE name ILIKE 'ada%'"),
            "SELECT * FROM t WHERE name LIKE 'ada%'"
        );
        // A deterministic emulator has no wall clock, so both spellings of "now" pin.
        assert_eq!(
            to_sqlite("INSERT INTO t (at) VALUES (now())"),
            format!("INSERT INTO t (at) VALUES ({FIXED_NOW})")
        );
        assert_eq!(
            to_sqlite("INSERT INTO t (at) VALUES (CURRENT_TIMESTAMP)"),
            format!("INSERT INTO t (at) VALUES ({FIXED_NOW})")
        );
    }

    /// A rewrite that reached inside a literal would change the value the student wrote.
    #[test]
    fn no_rewrite_reaches_inside_a_literal_or_a_comment() {
        for untouched in [
            "SELECT 'ILIKE'",
            "INSERT INTO t (note) VALUES ('SERIAL PRIMARY KEY')",
            "SELECT 1 -- ILIKE now()\n",
            "SELECT /* SERIAL */ 1",
            "SELECT 'now()'",
        ] {
            assert_eq!(to_sqlite(untouched), untouched, "{untouched}");
        }
    }

    /// A longer word that merely starts with a keyword is not that keyword.
    #[test]
    fn a_rewrite_only_matches_a_whole_word() {
        assert_eq!(
            match_keyword("SERIAL PRIMARY KEY,", "SERIAL PRIMARY KEY"),
            Some(18)
        );
        assert_eq!(
            match_keyword("serial\n\tprimary  key)", "SERIAL PRIMARY KEY"),
            Some(20)
        );
        assert_eq!(match_keyword("SERIALISED", "SERIAL"), None);
        assert_eq!(match_keyword("SERIAL", "SERIAL PRIMARY KEY"), None);
        assert_eq!(match_keyword("SER", "SERIAL"), None);
        for untouched in [
            "CREATE TABLE t (serialised TEXT)",
            "SELECT ilikeness FROM t",
            "SELECT now_ish FROM t",
            "SELECT current_timestamps FROM t",
        ] {
            assert_eq!(to_sqlite(untouched), untouched, "{untouched}");
        }
    }

    #[test]
    fn the_verb_classes_a_rule_may_trigger_on_are_all_real_verbs() {
        for class in [READ_VERBS, WRITE_VERBS, TRANSACTION_VERBS] {
            for member in class {
                assert!(VERBS.contains(member), "{member} is not a verb");
            }
        }
    }
}
