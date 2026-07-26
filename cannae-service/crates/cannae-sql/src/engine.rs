//! The engine: SQLite in-memory behind the Postgres wire face, plus the mapping from
//! SQLite's errors to the SQLSTATEs a driver keys its behaviour off.
//!
//! **Why SQLite and not a hand-written SQL engine** (`plans/infra-emulators.md` §4):
//! the student never sees it — they see the Postgres protocol — and writing a correct
//! SQL engine to teach transactions with would be the wrong project.
//!
//! **Why a shared-cache in-memory database.** Every client connection opens its own
//! SQLite handle onto one `cache=shared` in-memory database. That is what gives each
//! student connection a *real, independent transaction*: `BEGIN` on one handle takes a
//! write lock the other handle then collides with, and that collision is what becomes
//! a Postgres serialization failure. One shared handle behind a mutex could not do it —
//! two connections would silently share one transaction. The cost of shared cache is
//! table-level locking rather than MVCC, which the README records as a divergence.

use crate::types::{self, Declared};
use crate::wire::{Field, PgError};
use rusqlite::types::Value;
use rusqlite::Connection;
use serde_json::{json, Map, Value as Json};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

/// Fields a seed body (or a snapshot) may carry. Anything else is a typo that would
/// otherwise seed nothing at all, so it is rejected.
const SEED_FIELDS: [&str; 3] = ["emulator", "schema", "rows"];

/// Object-name prefixes that are not part of a lesson's schema: SQLite's own
/// bookkeeping and the `pg_catalog` stubs below. Objects named with one are never
/// dropped by a seed, never dumped by `/state`, and never written to a snapshot.
///
/// Reserving `pg_` costs a lesson nothing — real Postgres reserves it too.
const INTERNAL_PREFIXES: [&str; 2] = ["sqlite_", "pg_"];

/// The `pg_catalog` relations a driver reads on connect, created empty.
///
/// **Empty is the honest answer, not a shortcut.** psycopg2's SQLAlchemy dialect opens
/// every connection by asking `pg_type`/`pg_namespace` whether the `hstore` extension is
/// installed; without these tables that query is a `42P01` and `engine.connect()` raises
/// before a lesson runs. With them it returns no rows, which is true — hstore is not
/// installed. Populating them with invented type rows is what would be a lie.
///
/// Grown from real compat failures, exactly like the probe list in [`crate::catalog`].
const CATALOG_STUBS: &str = "\
    CREATE TABLE pg_namespace (oid INTEGER, nspname TEXT);\
    CREATE TABLE pg_type (oid INTEGER, typname TEXT, typnamespace INTEGER, \
        typarray INTEGER, typtype TEXT, typelem INTEGER, typbasetype INTEGER, \
        typcategory TEXT, typlen INTEGER, typnotnull INTEGER, typtypmod INTEGER);\
    CREATE TABLE pg_class (oid INTEGER, relname TEXT, relnamespace INTEGER, \
        relkind TEXT, relpersistence TEXT);\
    CREATE TABLE pg_extension (oid INTEGER, extname TEXT, extnamespace INTEGER);";

/// What one statement produced.
#[derive(Debug)]
pub struct Executed {
    /// Result columns, empty for a statement that returns none.
    pub fields: Vec<Field>,
    /// Rows, already rendered as the text the wire carries.
    pub rows: Vec<Vec<Option<Vec<u8>>>>,
    /// Rows changed, or — for `RETURNING` and `SELECT` — rows produced. This is the
    /// count in `CommandComplete`, which every client reports as its rowcount.
    pub affected: usize,
}

/// The lesson's database. Owns the keeper connection: a `cache=shared` in-memory
/// database exists only while some connection to it is open, so this handle is what
/// keeps seeded data alive between student connections.
pub struct Engine {
    uri: String,
    keeper: Connection,
}

impl Default for Engine {
    fn default() -> Self {
        Engine::new()
    }
}

impl Engine {
    /// A fresh, empty database on a URI no other engine shares — tests run many
    /// emulators at once and two of them sharing a keyspace would be untraceable.
    pub fn new() -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(1);
        let uri = format!(
            "file:cannae-sql-{}?mode=memory&cache=shared",
            NEXT.fetch_add(1, Ordering::SeqCst)
        );
        let keeper = open(&uri);
        // Created once and never dropped: `INTERNAL_PREFIXES` keeps every seed from
        // clearing them, so a driver's connect-time probes work on a fresh database and
        // on every one a `/reset` restores.
        if let Err(error) = keeper.execute_batch(CATALOG_STUBS) {
            eprintln!("cannae sql: the pg_catalog stubs failed to install ({error}); aborting");
            std::process::abort();
        }
        Engine { uri, keeper }
    }

    /// A handle for one client connection, with its own transaction context.
    pub fn open_session(&self) -> Connection {
        open(&self.uri)
    }

    /// Replace the schema and rows from a seed body or a snapshot. One loader for
    /// both: [`Self::snapshot`] emits a body this same function reads back.
    pub fn load(&mut self, body: &Json) -> Result<(), String> {
        let fields = body.as_object().ok_or("seed body must be an object")?;
        if let Some(unknown) = fields
            .keys()
            .find(|key| !SEED_FIELDS.contains(&key.as_str()))
        {
            return Err(format!(
                "unknown seed field {unknown}; expected one of: {}",
                SEED_FIELDS.join(", ")
            ));
        }
        let schema = read_schema(fields.get("schema"))?;
        let rows = match fields.get("rows") {
            None => Map::new(),
            Some(value) => value.as_object().ok_or("rows must be an object")?.clone(),
        };

        self.drop_everything()?;
        for statement in schema {
            self.keeper
                .execute_batch(&crate::statements::to_sqlite(&statement))
                .map_err(|error| format!("schema statement {statement:?} failed: {error}"))?;
        }
        for (table, table_rows) in rows.iter() {
            self.insert_rows(table, table_rows)?;
        }
        Ok(())
    }

    /// The reset baseline: the schema as SQLite holds it plus every row, in a shape
    /// [`Self::load`] reads back exactly. Values keep their storage type — a blob is a
    /// byte array, not the `\x…` text `/state` shows — so a round trip is lossless.
    pub fn snapshot(&self) -> Json {
        let schema = self.schema_sql().unwrap_or_default();
        let mut rows = Map::new();
        for table in self.table_names().unwrap_or_default() {
            let dumped = self
                .dump_table(&table, types::to_snapshot_json)
                .unwrap_or_default();
            rows.insert(table, Json::Array(dumped));
        }
        json!({ "schema": schema, "rows": rows })
    }

    /// What `GET /state` returns — every table's and view's rows in insertion order,
    /// which is what a grader asserts on ("is account 1 still worth 900.00?"). Views are
    /// included because a lesson may teach one, and a grader should be able to read it.
    ///
    /// A failure here is reported rather than swallowed: a grader reading `{}` and
    /// concluding "no rows" would pass a lesson that never ran.
    pub fn state(&self) -> Json {
        let mut tables = Map::new();
        let mut errors = Vec::new();
        match self.relation_names() {
            Err(error) => errors.push(error),
            Ok(names) => {
                for table in names {
                    match self.dump_table(&table, types::to_json) {
                        Ok(rows) => {
                            tables.insert(table, Json::Array(rows));
                        }
                        Err(error) => errors.push(error),
                    }
                }
            }
        }
        let mut state = json!({ "tables": tables });
        if !errors.is_empty() {
            state["error"] = json!(errors.join("; "));
        }
        state
    }

    /// Drop every object the seed created, so loading replaces rather than merges.
    /// Foreign keys are switched off around the loop: the drop order is alphabetical
    /// and a child table can outlive its parent for a moment.
    fn drop_everything(&self) -> Result<(), String> {
        let objects = self
            .objects_of_kinds(&["trigger", "view", "index", "table"])
            .map_err(|error| format!("could not list existing objects: {error}"))?;
        let mut batch = String::from("PRAGMA foreign_keys = OFF;\n");
        for (kind, name) in objects {
            batch.push_str(&format!("DROP {kind} IF EXISTS \"{name}\";\n"));
        }
        batch.push_str("PRAGMA foreign_keys = ON;\n");
        self.keeper
            .execute_batch(&batch)
            .map_err(|error| format!("could not clear the database: {error}"))
    }

    /// `(kind, name)` for every object of the given kinds, ordered as listed — so
    /// dependants are dropped before what they depend on.
    fn objects_of_kinds(&self, kinds: &[&str]) -> rusqlite::Result<Vec<(String, String)>> {
        let mut objects = Vec::new();
        for kind in kinds {
            let mut statement = self
                .keeper
                .prepare("SELECT name FROM sqlite_master WHERE type = ?1 ORDER BY name")?;
            let names = statement.query_map([kind], |row| row.get::<_, String>(0))?;
            for name in names {
                let name = name?;
                if !is_internal(&name) {
                    objects.push(((*kind).to_string(), name));
                }
            }
        }
        Ok(objects)
    }

    /// Tables only — what a snapshot dumps rows from. A view's rows are derived, so
    /// replaying them would fail.
    fn table_names(&self) -> Result<Vec<String>, String> {
        self.named(&["table"])
    }

    /// Tables and views — what `/state` dumps.
    fn relation_names(&self) -> Result<Vec<String>, String> {
        self.named(&["table", "view"])
    }

    fn named(&self, kinds: &[&str]) -> Result<Vec<String>, String> {
        self.objects_of_kinds(kinds)
            .map(|objects| objects.into_iter().map(|(_, name)| name).collect())
            .map_err(|error| format!("could not list relations: {error}"))
    }

    /// Every `CREATE` statement in the database, tables before indexes so a replay
    /// cannot index a table that does not exist yet.
    fn schema_sql(&self) -> Result<Vec<Json>, String> {
        let mut statements = Vec::new();
        for kind in ["table", "index", "view", "trigger"] {
            let mut query = self
                .keeper
                .prepare(
                    "SELECT name, sql FROM sqlite_master WHERE type = ?1 \
                     AND sql IS NOT NULL ORDER BY name",
                )
                .map_err(|error| error.to_string())?;
            let rows = query
                .query_map([kind], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(|error| error.to_string())?;
            for row in rows {
                let (name, sql) = row.map_err(|error| error.to_string())?;
                if !is_internal(&name) {
                    statements.push(json!(sql));
                }
            }
        }
        Ok(statements)
    }

    /// One table's columns and their declared Postgres types, as the lesson's DDL
    /// wrote them — this is the type manifest, read straight back out of SQLite.
    fn columns_of(&self, table: &str) -> rusqlite::Result<Vec<(String, Option<Declared>)>> {
        let mut query = self
            .keeper
            .prepare("SELECT name, type FROM pragma_table_info(?1) ORDER BY cid")?;
        let rows = query.query_map([table], |row| {
            let name: String = row.get(0)?;
            let declaration: String = row.get(1)?;
            Ok((name, declaration))
        })?;
        rows.map(|row| {
            row.map(|(name, declaration)| {
                let declared = (!declaration.is_empty()).then(|| Declared::parse(&declaration));
                (name, declared)
            })
        })
        .collect()
    }

    /// Dump one relation's rows as JSON objects, rendering each value with `render`.
    ///
    /// Ordered by `rowid` so two runs of the same scenario dump identical bytes. A view
    /// has no `rowid`, so it falls back to the relation's natural order — which for a
    /// view is its own query's, and therefore just as reproducible.
    fn dump_table(
        &self,
        table: &str,
        render: fn(&Value, Option<&Declared>) -> Json,
    ) -> Result<Vec<Json>, String> {
        let columns = self
            .columns_of(table)
            .map_err(|error| format!("{table}: {error}"))?;
        let names: Vec<String> = columns.iter().map(|(name, _)| quote(name)).collect();
        let select = format!("SELECT {} FROM {}", names.join(", "), quote(table));
        let mut query = self
            .keeper
            .prepare(&format!("{select} ORDER BY rowid"))
            .or_else(|_| self.keeper.prepare(&select))
            .map_err(|error| format!("{table}: {error}"))?;
        let mut found = Vec::new();
        let mut rows = query
            .query([])
            .map_err(|error| format!("{table}: {error}"))?;
        while let Some(row) = rows.next().map_err(|error| format!("{table}: {error}"))? {
            let mut object = Map::new();
            for (index, (name, declared)) in columns.iter().enumerate() {
                let value: Value = row
                    .get(index)
                    .map_err(|error| format!("{table}.{name}: {error}"))?;
                object.insert(name.clone(), render(&value, declared.as_ref()));
            }
            found.push(Json::Object(object));
        }
        Ok(found)
    }

    /// Insert one table's seeded rows. Each row is inserted with exactly the columns it
    /// names, so a fixture may leave a defaulted or serial column out.
    fn insert_rows(&self, table: &str, rows: &Json) -> Result<(), String> {
        let rows = rows
            .as_array()
            .ok_or(format!("rows.{table} must be an array of objects"))?;
        for (index, row) in rows.iter().enumerate() {
            let fields = row
                .as_object()
                .ok_or(format!("rows.{table}[{index}] must be an object"))?;
            if fields.is_empty() {
                return Err(format!("rows.{table}[{index}] names no columns"));
            }
            let columns: Vec<String> = fields.keys().map(|name| quote(name)).collect();
            let markers: Vec<String> = (1..=fields.len()).map(|n| format!("?{n}")).collect();
            let values: Vec<Value> = fields
                .iter()
                .map(|(column, value)| types::from_json(&format!("rows.{table}.{column}"), value))
                .collect::<Result<_, _>>()?;
            let sql = format!(
                "INSERT INTO {} ({}) VALUES ({})",
                quote(table),
                columns.join(", "),
                markers.join(", ")
            );
            self.keeper
                .execute(&sql, rusqlite::params_from_iter(values))
                .map_err(|error| format!("rows.{table}[{index}]: {error}"))?;
        }
        Ok(())
    }
}

/// Open one handle onto a shared-cache in-memory database.
///
/// Two settings are deliberate. Foreign keys are **on**, because SQLite defaults them
/// off and a lesson whose `REFERENCES` clause was silently unenforced would teach that
/// referential integrity is optional. The busy timeout is **zero**, because a lock
/// conflict is the lesson: waiting five seconds and then succeeding would hide the
/// serialization failure a retry lesson is built to provoke.
fn open(uri: &str) -> Connection {
    let connection = Connection::open(uri).and_then(|connection| {
        connection.busy_timeout(Duration::ZERO)?;
        connection.execute_batch("PRAGMA foreign_keys = ON")?;
        Ok(connection)
    });
    match connection {
        Ok(connection) => connection,
        // Nothing here touches a filesystem or a network, so the only way to fail is
        // for the process to be out of memory — at which point no connection can ever
        // be served and a running-but-dead emulator would mis-grade every lesson after
        // it. Abort rather than panic: a panic would unwind through a control-plane
        // handler holding the engine lock and poison it, which looks healthy from
        // outside. (Same reasoning as `cannae-cache`'s snapshot guard.)
        Err(error) => {
            eprintln!("cannae sql: could not open the in-memory database ({error}); aborting");
            std::process::abort();
        }
    }
}

/// Whether an object belongs to the emulator rather than to a lesson's schema.
fn is_internal(name: &str) -> bool {
    INTERNAL_PREFIXES
        .iter()
        .any(|prefix| name.starts_with(prefix))
}

/// Quote an identifier so a column called `order` or `from` is usable. A `"` inside an
/// identifier is doubled, which is SQL's own escape.
fn quote(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}

/// A seed body's `schema`: one SQL string, or a list of them. Either way it ends up as
/// a list of statements, so a lesson can write its DDL however reads best.
fn read_schema(schema: Option<&Json>) -> Result<Vec<String>, String> {
    match schema {
        None => Ok(Vec::new()),
        Some(Json::String(sql)) => Ok(crate::statements::split(sql)),
        Some(Json::Array(items)) => items
            .iter()
            .map(|item| {
                item.as_str()
                    .map(str::to_string)
                    .ok_or("schema entries must be SQL strings".to_string())
            })
            .collect(),
        Some(_) => Err("schema must be a SQL string or a list of them".into()),
    }
}

/// Run one statement on a client connection's own handle.
///
/// `params` are the text-format values from a `Bind`; `None` is SQL NULL. Rows are
/// materialised rather than streamed so a portal can be drained across several
/// `Execute` messages without holding a SQLite cursor open across them.
pub fn run(db: &Connection, sql: &str, params: &[Option<Vec<u8>>]) -> Result<Executed, PgError> {
    let translated = crate::statements::to_sqlite(sql);
    let mut statement = db.prepare(&translated).map_err(|error| error_of(&error))?;
    let bound: Vec<Value> = params.iter().map(bind_value).collect();

    if statement.column_count() == 0 {
        let affected = statement
            .execute(rusqlite::params_from_iter(bound))
            .map_err(|error| error_of(&error))?;
        return Ok(Executed {
            fields: Vec::new(),
            rows: Vec::new(),
            affected,
        });
    }

    let declared: Vec<Option<Declared>> = statement
        .columns()
        .iter()
        .map(|column| column.decl_type().map(Declared::parse))
        .collect();
    let names: Vec<String> = statement
        .columns()
        .iter()
        .map(|column| column.name().to_string())
        .collect();

    let mut rows = Vec::new();
    let mut samples: Vec<Option<Value>> = vec![None; names.len()];
    let mut cursor = statement
        .query(rusqlite::params_from_iter(bound))
        .map_err(|error| error_of(&error))?;
    while let Some(row) = cursor.next().map_err(|error| error_of(&error))? {
        let mut encoded = Vec::with_capacity(names.len());
        for (index, declaration) in declared.iter().enumerate() {
            let value: Value = row.get(index).map_err(|error| error_of(&error))?;
            // The first non-null value in a column is what a computed column's type
            // OID is inferred from, so remember it.
            if samples[index].is_none() && value != Value::Null {
                samples[index] = Some(value.clone());
            }
            encoded.push(encode_column(&value, declaration.as_ref()));
        }
        rows.push(encoded);
    }

    let fields = names
        .into_iter()
        .enumerate()
        .map(|(index, name)| Field {
            name,
            oid: types::column_oid(declared[index].as_ref(), samples[index].as_ref()),
        })
        .collect();
    let affected = rows.len();
    Ok(Executed {
        fields,
        rows,
        affected,
    })
}

/// What a statement would return, answered without running it — the reply to a
/// `Describe` in the extended protocol.
///
/// A column's OID here can only come from its declared type: there are no rows yet to
/// infer a computed column's type from, so those are reported as text. Real Postgres
/// knows better, and this is the one place the emulator is less precise than it — a
/// client uses the OID to pick a decoder, and every type here decodes from text.
#[derive(Debug)]
pub struct Described {
    pub fields: Vec<Field>,
    /// How many parameters the statement takes, for `ParameterDescription`.
    pub parameters: usize,
}

pub fn describe(db: &Connection, sql: &str) -> Result<Described, PgError> {
    let statement = db
        .prepare(&crate::statements::to_sqlite(sql))
        .map_err(|error| error_of(&error))?;
    let fields = statement
        .columns()
        .iter()
        .map(|column| Field {
            name: column.name().to_string(),
            oid: types::column_oid(column.decl_type().map(Declared::parse).as_ref(), None),
        })
        .collect();
    Ok(Described {
        fields,
        parameters: statement.parameter_count(),
    })
}

/// Render one column value. A `bool` column is the one type whose SQLite storage
/// (`0`/`1`) is not what Postgres sends (`f`/`t`), and every client decodes the latter.
fn encode_column(value: &Value, declared: Option<&Declared>) -> Option<Vec<u8>> {
    match declared.map(Declared::oid) == Some(types::BOOL_OID) {
        true => types::encode_bool(value),
        false => types::encode(value, declared),
    }
}

/// A `Bind` parameter as a SQLite value. Everything arrives as text — the emulator
/// refuses binary format (see [`crate::session`]) — and SQLite applies the target
/// column's affinity, so `'5'` compares equal to the integer `5`. A parameter that is
/// not UTF-8 can only be a `bytea`, so it is bound as a blob rather than mangled.
fn bind_value(param: &Option<Vec<u8>>) -> Value {
    match param {
        None => Value::Null,
        Some(bytes) => match std::str::from_utf8(bytes) {
            Ok(text) => Value::Text(text.to_string()),
            Err(_) => Value::Blob(bytes.clone()),
        },
    }
}

/// Map a SQLite error onto the Postgres SQLSTATE a driver keys its behaviour off.
///
/// This mapping is the contract §11 of the plan calls out as risk 2: a client retries
/// on `40001`, reports a duplicate on `23505`, and gives up on `42601`. Getting the
/// code wrong is worse than getting the message wrong, because the code is what the
/// student's `except` clause matches.
pub fn error_of(error: &rusqlite::Error) -> PgError {
    use rusqlite::ffi::ErrorCode;
    // Classification reads SQLite's own words; only the message handed to the client is
    // rewritten, at the very end. Rewriting first would hide the markers below —
    // `no such table` would stop being a `42P01`.
    let raw = error.to_string();
    let code = match error {
        // A failure while *preparing* arrives wrapped, with the offending SQL attached.
        // Unwrapping it is what makes "no such table" a `42P01` rather than the
        // catch-all — and every statement is prepared before it runs.
        // `msg` is SQLite's own message; the wrapper's `to_string` also tacks on the
        // offending SQL and a byte offset, which is not what a client should be shown.
        rusqlite::Error::SqlInputError { error, msg, .. } => {
            return error_of(&rusqlite::Error::SqliteFailure(*error, Some(msg.clone())))
        }
        // A lock conflict between two connections. Postgres would report a
        // serialization failure or a deadlock; both mean "retry the transaction", which
        // is exactly what a lesson wants the student to learn.
        rusqlite::Error::SqliteFailure(failure, _) => match failure.code {
            ErrorCode::DatabaseBusy | ErrorCode::DatabaseLocked => SERIALIZATION_FAILURE,
            ErrorCode::ConstraintViolation => constraint_sqlstate(&raw),
            ErrorCode::TypeMismatch => "42804",
            ErrorCode::ReadOnly => "25006",
            ErrorCode::OperationAborted | ErrorCode::OperationInterrupted => "57014",
            _ => syntax_or_missing_object(&raw),
        },
        // The client sent a different number of parameters than the statement uses.
        // That is a protocol-level disagreement, not bad SQL.
        rusqlite::Error::InvalidParameterCount(_, _) => "08P01",
        rusqlite::Error::InvalidParameterName(_) => "42P02",
        _ => INTERNAL_ERROR,
    };
    PgError::new(code, postgres_wording(&raw))
}

/// Rewrite the two SQLite messages a student meets most often into the wording real
/// Postgres uses. A misspelt table is the single commonest error in a SQL lesson, and
/// `no such table: accounts` is a visible tell that this is not Postgres.
///
/// Only these two are translated, and deliberately so: SQLite hands back the exact
/// identifier for both, so the rewrite adds no information it does not have. Constraint
/// violations are left in SQLite's own words — Postgres names the *constraint* in those
/// messages, and inventing a plausible constraint name would be a lie a lesson could
/// match on. Their SQLSTATEs are exact, which is what a client branches on.
fn postgres_wording(message: &str) -> String {
    for (marker, shape) in [
        ("no such table: ", "relation"),
        ("no such column: ", "column"),
    ] {
        let Some(name) = message.strip_prefix(marker) else {
            continue;
        };
        // The identifier is the first word: SQLite sometimes qualifies it with its
        // database (`main.accounts`) and sometimes trails other text after it.
        let bare = name.split_whitespace().next().unwrap_or(name);
        let bare = bare.rsplit('.').next().unwrap_or(bare);
        return format!("{shape} \"{bare}\" does not exist");
    }
    message.to_string()
}

/// SQLSTATE `40001` — serialization_failure. A retryable conflict.
pub const SERIALIZATION_FAILURE: &str = "40001";
/// SQLSTATE `25P02` — in_failed_sql_transaction. Every statement but `COMMIT` /
/// `ROLLBACK` is refused until the block ends.
pub const IN_FAILED_TRANSACTION: &str = "25P02";
/// SQLSTATE `XX000` — internal_error, for anything with no better mapping.
pub const INTERNAL_ERROR: &str = "XX000";

/// Which constraint SQLite refused, from the message it refused with — SQLite reports
/// one error code for all of them, and the four Postgres codes are what a client's
/// error handling actually branches on.
fn constraint_sqlstate(message: &str) -> &'static str {
    let lowered = message.to_ascii_lowercase();
    for (marker, code) in [
        ("unique", "23505"),
        ("primary key", "23505"),
        ("not null", "23502"),
        ("foreign key", "23503"),
        ("check", "23514"),
    ] {
        if lowered.contains(marker) {
            return code;
        }
    }
    // integrity_constraint_violation — the family, when the member is unclear.
    "23000"
}

/// Tell "you named something that does not exist" apart from "that is not SQL". Both
/// arrive from SQLite as a generic failure, and a driver reports them very differently.
fn syntax_or_missing_object(message: &str) -> &'static str {
    let lowered = message.to_ascii_lowercase();
    for (marker, code) in [
        ("no such table", "42P01"),
        ("no such column", "42703"),
        ("no such function", "42883"),
        ("has no column named", "42703"),
        ("already exists", "42P07"),
        ("ambiguous column name", "42702"),
        ("cannot start a transaction within a transaction", "25001"),
        ("cannot commit - no transaction is active", "25P01"),
        ("cannot rollback - no transaction is active", "25P01"),
    ] {
        if lowered.contains(marker) {
            return code;
        }
    }
    // syntax_error — SQLite's catch-all is a parse failure far more often than not.
    "42601"
}

#[cfg(test)]
mod tests {
    use super::*;

    const BANK: &str = "CREATE TABLE accounts (\
        id SERIAL PRIMARY KEY, owner TEXT NOT NULL UNIQUE, \
        balance NUMERIC(12,2) NOT NULL CHECK (balance >= 0))";

    fn bank() -> Engine {
        let mut engine = Engine::new();
        engine
            .load(&json!({
                "schema": [BANK],
                "rows": { "accounts": [
                    { "owner": "ada", "balance": "1000.00" },
                    { "owner": "grace", "balance": "500.00" },
                ] }
            }))
            .unwrap();
        engine
    }

    fn text_of(executed: &Executed, row: usize, column: usize) -> String {
        String::from_utf8(executed.rows[row][column].clone().unwrap()).unwrap()
    }

    #[test]
    fn a_seeded_schema_and_rows_are_queryable() {
        let engine = bank();
        let db = engine.open_session();
        let executed = run(
            &db,
            "SELECT id, owner, balance FROM accounts ORDER BY id",
            &[],
        )
        .unwrap();
        assert_eq!(executed.affected, 2);
        assert_eq!(text_of(&executed, 0, 0), "1");
        assert_eq!(text_of(&executed, 0, 1), "ada");
        // Money is rendered at its declared scale, exactly.
        assert_eq!(text_of(&executed, 0, 2), "1000.00");
        assert_eq!(
            executed.fields.iter().map(|f| f.oid).collect::<Vec<_>>(),
            vec![types::INT4_OID, types::TEXT_OID, types::NUMERIC_OID]
        );
    }

    #[test]
    fn seeding_replaces_rather_than_merges() {
        let mut engine = bank();
        engine
            .load(&json!({ "schema": ["CREATE TABLE only (id INTEGER)"] }))
            .unwrap();
        let db = engine.open_session();
        assert_eq!(
            run(&db, "SELECT * FROM accounts", &[])
                .unwrap_err()
                .sqlstate,
            "42P01"
        );
        assert_eq!(engine.state()["tables"], json!({ "only": [] }));
    }

    #[test]
    fn an_empty_seed_body_clears_the_database() {
        let mut engine = bank();
        engine.load(&json!({ "emulator": "sql" })).unwrap();
        assert_eq!(engine.state(), json!({ "tables": {} }));
    }

    #[test]
    fn a_schema_may_be_one_string_of_statements_or_a_list() {
        let mut engine = Engine::new();
        engine
            .load(&json!({
                "schema": "CREATE TABLE a (id INT); CREATE TABLE b (id INT);"
            }))
            .unwrap();
        assert_eq!(engine.table_names().unwrap(), vec!["a", "b"]);
    }

    #[test]
    fn indexes_views_and_triggers_are_dropped_and_restored_with_the_schema() {
        let mut engine = Engine::new();
        engine
            .load(&json!({ "schema": [
                "CREATE TABLE t (id INTEGER PRIMARY KEY, n INT)",
                "CREATE INDEX t_n ON t (n)",
                "CREATE VIEW v AS SELECT n FROM t",
            ] }))
            .unwrap();
        let snapshot = engine.snapshot();
        // `/state` lists views alongside tables; a snapshot dumps rows from tables only.
        assert!(engine.state()["tables"].get("v").is_some());
        assert!(snapshot["rows"].get("v").is_none());
        engine.load(&json!({ "schema": [] })).unwrap();
        assert_eq!(engine.state(), json!({ "tables": {} }));
        // A snapshot replays every object, and replaying it twice must not clash.
        engine.load(&snapshot).unwrap();
        engine.load(&snapshot).unwrap();
        assert!(engine
            .schema_sql()
            .unwrap()
            .iter()
            .any(|sql| sql.as_str().unwrap().contains("CREATE INDEX")));
    }

    #[test]
    fn a_snapshot_round_trips_every_value_losslessly() {
        let mut engine = Engine::new();
        engine
            .load(&json!({
                "schema": ["CREATE TABLE t (id SERIAL PRIMARY KEY, blob BYTEA, note TEXT, \
                            money NUMERIC(12,2), flag BOOLEAN, ratio DOUBLE PRECISION)"],
                "rows": { "t": [
                    { "blob": [0, 255, 128], "note": null, "money": "12.50",
                      "flag": true, "ratio": 1.5 },
                ] }
            }))
            .unwrap();
        let snapshot = engine.snapshot();
        let before = engine.state();

        engine
            .load(&json!({ "schema": ["CREATE TABLE gone (id INT)"] }))
            .unwrap();
        engine.load(&snapshot).unwrap();

        assert_eq!(engine.state(), before);
        assert_eq!(
            before["tables"]["t"][0],
            json!({ "id": 1, "blob": "\\x00ff80", "note": null, "money": "12.50",
                    "flag": true, "ratio": 1.5 })
        );
    }

    /// A `SERIAL` sequence rewinds with the data, so two runs of the same scenario
    /// produce the same ids — the determinism guarantee in `plans/infra-emulators.md` §8.
    #[test]
    fn restoring_rewinds_the_serial_sequence() {
        let mut engine = bank();
        let baseline = engine.snapshot();
        let db = engine.open_session();
        run(
            &db,
            "INSERT INTO accounts (owner, balance) VALUES ('new', 0)",
            &[],
        )
        .unwrap();
        drop(db);

        engine.load(&baseline).unwrap();
        let db = engine.open_session();
        run(
            &db,
            "INSERT INTO accounts (owner, balance) VALUES ('new', 0)",
            &[],
        )
        .unwrap();
        let executed = run(&db, "SELECT id FROM accounts WHERE owner = 'new'", &[]).unwrap();
        assert_eq!(text_of(&executed, 0, 0), "3", "the id must not creep");
    }

    #[test]
    fn bad_seed_bodies_fail_loudly() {
        let rejected: Vec<(Json, &str)> = vec![
            (json!("not an object"), "must be an object"),
            (json!({ "schemas": [] }), "unknown seed field"),
            (json!({ "schema": 7 }), "must be a SQL string"),
            (json!({ "schema": [7] }), "must be SQL strings"),
            (json!({ "schema": ["NOT SQL AT ALL"] }), "failed"),
            (json!({ "rows": [] }), "rows must be an object"),
            (json!({ "rows": { "nope": [{ "a": 1 }] } }), "no such table"),
            (
                json!({ "schema": [BANK], "rows": { "accounts": {} } }),
                "must be an array",
            ),
            (
                json!({ "schema": [BANK], "rows": { "accounts": [7] } }),
                "must be an object",
            ),
            (
                json!({ "schema": [BANK], "rows": { "accounts": [{}] } }),
                "names no columns",
            ),
            (
                json!({ "schema": [BANK], "rows": { "accounts": [{ "owner": {} }] } }),
                "must be a string, number, boolean, null",
            ),
            (
                json!({ "schema": [BANK], "rows": { "accounts": [{ "nope": 1 }] } }),
                "has no column named",
            ),
            (
                json!({ "schema": [BANK], "rows": { "accounts": [{ "owner": "a", "balance": -1 }] } }),
                "CHECK",
            ),
        ];
        for (body, expected) in rejected {
            let error = Engine::new()
                .load(&body)
                .expect_err(&format!("must be rejected: {body}"));
            assert!(error.contains(expected), "{body} gave {error:?}");
        }
    }

    #[test]
    fn a_row_may_omit_a_defaulted_or_serial_column() {
        let mut engine = Engine::new();
        engine
            .load(&json!({
                "schema": ["CREATE TABLE t (id SERIAL PRIMARY KEY, n INT DEFAULT 7, m INT)"],
                "rows": { "t": [{ "m": 1 }] }
            }))
            .unwrap();
        assert_eq!(
            engine.state()["tables"]["t"][0],
            json!({"id": 1, "n": 7, "m": 1})
        );
    }

    #[test]
    fn a_reserved_word_is_usable_as_a_table_or_column_name() {
        let mut engine = Engine::new();
        engine
            .load(&json!({
                "schema": ["CREATE TABLE \"order\" (\"from\" TEXT, \"sel\"\"ect\" TEXT)"],
                "rows": { "order": [{ "from": "ada", "sel\"ect": "x" }] }
            }))
            .unwrap();
        assert_eq!(
            engine.state()["tables"]["order"][0],
            json!({ "from": "ada", "sel\"ect": "x" })
        );
    }

    #[test]
    fn a_statement_that_changes_rows_reports_how_many() {
        let engine = bank();
        let db = engine.open_session();
        let executed = run(&db, "UPDATE accounts SET balance = balance - 100", &[]).unwrap();
        assert_eq!(executed.affected, 2);
        assert!(executed.fields.is_empty());
        assert_eq!(
            run(&db, "DELETE FROM accounts WHERE owner = 'grace'", &[])
                .unwrap()
                .affected,
            1
        );
    }

    #[test]
    fn returning_hands_back_rows_from_a_write() {
        let engine = bank();
        let db = engine.open_session();
        let executed = run(
            &db,
            "UPDATE accounts SET balance = balance - 100 WHERE owner = 'ada' RETURNING balance",
            &[],
        )
        .unwrap();
        assert_eq!(executed.affected, 1);
        assert_eq!(text_of(&executed, 0, 0), "900.00");
    }

    #[test]
    fn text_parameters_are_bound_and_compared_by_column_affinity() {
        let engine = bank();
        let db = engine.open_session();
        // The client sent the id as text; the column is an integer, and SQLite applies
        // the column's affinity — so this matches, exactly as Postgres would.
        let executed = run(
            &db,
            "SELECT owner FROM accounts WHERE id = $1",
            &[Some(b"1".to_vec())],
        )
        .unwrap();
        assert_eq!(text_of(&executed, 0, 0), "ada");
        // A NULL parameter is not an empty string.
        let executed = run(
            &db,
            "SELECT count(*) FROM accounts WHERE owner = $1",
            &[None],
        )
        .unwrap();
        assert_eq!(text_of(&executed, 0, 0), "0");
    }

    #[test]
    fn a_non_utf8_parameter_is_bound_as_bytes_not_mangled() {
        let mut engine = Engine::new();
        engine
            .load(&json!({ "schema": ["CREATE TABLE t (b BYTEA)"] }))
            .unwrap();
        let db = engine.open_session();
        run(
            &db,
            "INSERT INTO t (b) VALUES ($1)",
            &[Some(vec![0xff, 0x00])],
        )
        .unwrap();
        assert_eq!(engine.state()["tables"]["t"][0], json!({ "b": "\\xff00" }));
    }

    /// A computed column has no declared type, so its OID comes from the value —
    /// `count(*)` is `int8` in Postgres and must be reported as one.
    #[test]
    fn a_computed_columns_type_is_inferred_from_its_value() {
        let engine = bank();
        let db = engine.open_session();
        let executed = run(&db, "SELECT count(*) AS n, 'x' AS s FROM accounts", &[]).unwrap();
        assert_eq!(executed.fields[0].name, "n");
        assert_eq!(executed.fields[0].oid, types::INT8_OID);
        assert_eq!(executed.fields[1].oid, types::TEXT_OID);
    }

    /// A column whose only visible rows are NULL still needs a type, and the first
    /// non-null value is what supplies it.
    #[test]
    fn a_column_takes_its_type_from_its_first_non_null_value() {
        let engine = bank();
        let db = engine.open_session();
        let executed = run(
            &db,
            "SELECT NULL AS n UNION ALL SELECT 1 UNION ALL SELECT 2",
            &[],
        )
        .unwrap();
        assert_eq!(executed.fields[0].oid, types::INT8_OID);
        assert_eq!(executed.rows[0][0], None);
    }

    #[test]
    fn a_boolean_column_is_sent_as_t_or_f() {
        let mut engine = Engine::new();
        engine
            .load(&json!({
                "schema": ["CREATE TABLE t (flag BOOLEAN)"],
                "rows": { "t": [{ "flag": true }, { "flag": false }] }
            }))
            .unwrap();
        let db = engine.open_session();
        let executed = run(&db, "SELECT flag FROM t ORDER BY rowid", &[]).unwrap();
        assert_eq!(text_of(&executed, 0, 0), "t");
        assert_eq!(text_of(&executed, 1, 0), "f");
        assert_eq!(executed.fields[0].oid, types::BOOL_OID);
    }

    /// Each connection has its own transaction, which is the whole reason for a
    /// shared-cache database — and a collision between them is the retry lesson.
    #[test]
    fn two_connections_hold_independent_transactions_and_can_conflict() {
        let engine = bank();
        let first = engine.open_session();
        let second = engine.open_session();

        run(&first, "BEGIN", &[]).unwrap();
        run(&first, "UPDATE accounts SET balance = 1 WHERE id = 1", &[]).unwrap();
        // The second connection cannot see the uncommitted write...
        let error = run(&second, "UPDATE accounts SET balance = 2 WHERE id = 1", &[]).unwrap_err();
        assert_eq!(error.sqlstate, SERIALIZATION_FAILURE);
        // ...and once the first rolls back, the second proceeds.
        run(&first, "ROLLBACK", &[]).unwrap();
        run(&second, "UPDATE accounts SET balance = 2 WHERE id = 1", &[]).unwrap();
        assert_eq!(
            engine.state()["tables"]["accounts"][0]["balance"],
            json!("2.00")
        );
    }

    /// Dropping a connection mid-transaction must lose the uncommitted work — the
    /// property the banking lesson's mid-transfer crash proves.
    #[test]
    fn dropping_a_connection_mid_transaction_rolls_it_back() {
        let engine = bank();
        let db = engine.open_session();
        run(&db, "BEGIN", &[]).unwrap();
        run(&db, "UPDATE accounts SET balance = 0 WHERE id = 1", &[]).unwrap();
        drop(db);
        assert_eq!(
            engine.state()["tables"]["accounts"][0]["balance"],
            json!("1000.00")
        );
    }

    #[test]
    fn foreign_keys_are_enforced_rather_than_silently_ignored() {
        let mut engine = Engine::new();
        engine
            .load(&json!({ "schema": [
                "CREATE TABLE parent (id INTEGER PRIMARY KEY)",
                "CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id))",
            ] }))
            .unwrap();
        let db = engine.open_session();
        let error = run(&db, "INSERT INTO child VALUES (1, 99)", &[]).unwrap_err();
        assert_eq!(error.sqlstate, "23503");
    }

    /// The code is what a student's `except` clause matches, so each family maps to the
    /// SQLSTATE a driver reports rather than to one catch-all.
    #[test]
    fn engine_errors_carry_the_sqlstate_a_driver_branches_on() {
        let engine = bank();
        let db = engine.open_session();
        let code =
            |sql: &str, params: &[Option<Vec<u8>>]| run(&db, sql, params).unwrap_err().sqlstate;
        assert_eq!(code("SELECT * FROM missing", &[]), "42P01");
        assert_eq!(code("SELECT missing FROM accounts", &[]), "42703");
        // The message a student reads is Postgres', not SQLite's.
        assert_eq!(
            run(&db, "SELECT * FROM missing", &[]).unwrap_err().message,
            "relation \"missing\" does not exist"
        );
        assert_eq!(
            run(&db, "SELECT missing FROM accounts", &[])
                .unwrap_err()
                .message,
            "column \"missing\" does not exist"
        );
        assert_eq!(code("SELECT missing_fn(1)", &[]), "42883");
        assert_eq!(code("NOT SQL", &[]), "42601");
        assert_eq!(code(BANK, &[]), "42P07");
        assert_eq!(
            code(
                "INSERT INTO accounts (owner, balance) VALUES ('ada', 1)",
                &[]
            ),
            "23505"
        );
        assert_eq!(
            code(
                "INSERT INTO accounts (owner, balance) VALUES (NULL, 1)",
                &[]
            ),
            "23502"
        );
        assert_eq!(
            code(
                "INSERT INTO accounts (owner, balance) VALUES ('z', -1)",
                &[]
            ),
            "23514"
        );
        // A parameter count the statement disagrees with is a protocol violation.
        assert_eq!(
            code("SELECT owner FROM accounts WHERE id = $1", &[]),
            "08P01"
        );
        assert_eq!(code("COMMIT", &[]), "25P01");
        run(&db, "BEGIN", &[]).unwrap();
        assert_eq!(code("BEGIN", &[]), "25001");
        run(&db, "ROLLBACK", &[]).unwrap();
    }

    /// SQLite's own wording for a missing relation is a visible tell; its wording for a
    /// constraint violation is truthful and is left alone.
    #[test]
    fn only_the_messages_sqlite_can_name_exactly_are_rewritten() {
        assert_eq!(
            postgres_wording("no such table: main.accounts"),
            "relation \"accounts\" does not exist"
        );
        assert_eq!(
            postgres_wording("no such column: owner"),
            "column \"owner\" does not exist"
        );
        // A prepare failure can trail the offending SQL after the identifier.
        assert_eq!(
            postgres_wording("no such column: owner in SELECT owner FROM t at offset 7"),
            "column \"owner\" does not exist"
        );
        // Left as SQLite wrote it: Postgres names the constraint here, and inventing a
        // plausible name would be a lie a lesson could match on.
        let unchanged = "UNIQUE constraint failed: accounts.owner";
        assert_eq!(postgres_wording(unchanged), unchanged);
        assert_eq!(
            postgres_wording("near \"NOT\": syntax error"),
            "near \"NOT\": syntax error"
        );
    }

    #[test]
    fn the_constraint_family_is_named_even_when_the_member_is_not() {
        assert_eq!(
            constraint_sqlstate("UNIQUE constraint failed: t.a"),
            "23505"
        );
        assert_eq!(constraint_sqlstate("PRIMARY KEY must be unique"), "23505");
        assert_eq!(constraint_sqlstate("NOT NULL constraint failed"), "23502");
        assert_eq!(
            constraint_sqlstate("FOREIGN KEY constraint failed"),
            "23503"
        );
        assert_eq!(constraint_sqlstate("CHECK constraint failed"), "23514");
        assert_eq!(constraint_sqlstate("something else entirely"), "23000");
    }

    #[test]
    fn an_unmapped_sqlite_failure_falls_back_to_an_internal_error() {
        assert_eq!(
            error_of(&rusqlite::Error::InvalidParameterName("$x".into())).sqlstate,
            "42P02"
        );
        assert_eq!(
            error_of(&rusqlite::Error::InvalidQuery).sqlstate,
            INTERNAL_ERROR
        );
        // A prepare failure arrives wrapped; unwrapping it is what keeps `42P01` from
        // collapsing into the catch-all.
        assert_eq!(
            error_of(&rusqlite::Error::SqlInputError {
                error: rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_ERROR),
                msg: "no such table: nope".into(),
                sql: "SELECT * FROM nope".into(),
                offset: 14,
            })
            .sqlstate,
            "42P01"
        );
        assert_eq!(
            error_of(&rusqlite::Error::SqliteFailure(
                rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_MISMATCH),
                Some("datatype mismatch".into())
            ))
            .sqlstate,
            "42804"
        );
        assert_eq!(
            error_of(&rusqlite::Error::SqliteFailure(
                rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_READONLY),
                None
            ))
            .sqlstate,
            "25006"
        );
        assert_eq!(
            error_of(&rusqlite::Error::SqliteFailure(
                rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_INTERRUPT),
                None
            ))
            .sqlstate,
            "57014"
        );
        assert_eq!(
            error_of(&rusqlite::Error::SqliteFailure(
                rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_ABORT),
                None
            ))
            .sqlstate,
            "57014"
        );
    }

    #[test]
    fn ambiguity_and_the_remaining_message_markers_map_too() {
        assert_eq!(
            syntax_or_missing_object("ambiguous column name: id"),
            "42702"
        );
        assert_eq!(
            syntax_or_missing_object("cannot rollback - no transaction is active"),
            "25P01"
        );
        assert_eq!(syntax_or_missing_object("something unfamiliar"), "42601");
    }

    /// A grader reading `{}` and concluding "no rows" would pass a lesson that never
    /// ran, so a failed dump says so in the payload.
    #[test]
    fn a_state_dump_that_cannot_read_a_table_reports_it() {
        let mut engine = Engine::new();
        engine
            .load(&json!({ "schema": [
                "CREATE TABLE t (id INT)",
                "CREATE VIEW broken AS SELECT id FROM t",
            ] }))
            .unwrap();
        // SQLite lets a table be dropped out from under a view, which leaves an object
        // `sqlite_master` still lists and nothing can read.
        let db = engine.open_session();
        db.execute_batch("DROP TABLE t").unwrap();
        drop(db);

        let state = engine.state();
        assert!(
            state["error"].as_str().unwrap().contains("broken"),
            "{state}"
        );
        assert_eq!(state["tables"], json!({}), "and no relation is invented");
    }

    /// `Describe` runs before any row exists, so a declared type is the only thing an
    /// OID can come from — and a broken statement must be reported here, where the
    /// client expects it, rather than at `Bind`.
    #[test]
    fn describing_a_statement_reports_its_columns_and_parameter_count() {
        let engine = bank();
        let db = engine.open_session();
        let described = describe(&db, "SELECT id, balance FROM accounts WHERE id = $1").unwrap();
        assert_eq!(described.parameters, 1);
        assert_eq!(
            described.fields.iter().map(|f| f.oid).collect::<Vec<_>>(),
            vec![types::INT4_OID, types::NUMERIC_OID]
        );
        // A statement that returns nothing has no fields, which is `NoData` on the wire.
        let described = describe(&db, "UPDATE accounts SET balance = 0").unwrap();
        assert!(described.fields.is_empty());
        assert_eq!(described.parameters, 0);
        // With no rows to infer from, a computed column is reported as text.
        assert_eq!(
            describe(&db, "SELECT count(*) FROM accounts")
                .unwrap()
                .fields[0]
                .oid,
            types::TEXT_OID
        );
        assert_eq!(
            describe(&db, "SELECT * FROM missing").unwrap_err().sqlstate,
            "42P01"
        );
    }

    #[test]
    fn an_identifier_is_quoted_so_a_reserved_word_is_usable() {
        assert_eq!(quote("order"), "\"order\"");
        assert_eq!(quote("a\"b"), "\"a\"\"b\"");
    }

    /// SQLite's bookkeeping and the `pg_catalog` stubs are the emulator's, not the
    /// lesson's: a grader must never see them and a seed must never drop them.
    #[test]
    fn internal_objects_are_invisible_to_a_lesson_and_survive_every_seed() {
        let mut engine = bank();
        // AUTOINCREMENT creates `sqlite_sequence`.
        assert!(!engine.table_names().unwrap().iter().any(|n| is_internal(n)));
        assert_eq!(
            engine.state()["tables"]
                .as_object()
                .unwrap()
                .keys()
                .collect::<Vec<_>>(),
            vec!["accounts"]
        );
        assert!(engine.snapshot()["rows"].get("pg_type").is_none());
        assert!(engine
            .schema_sql()
            .unwrap()
            .iter()
            .all(|sql| !sql.as_str().unwrap().contains("pg_type")));

        // A driver's connect-time probe must work after any seed, including an empty one.
        engine.load(&json!({})).unwrap();
        let db = engine.open_session();
        let probe = run(
            &db,
            "SELECT t.oid, t.typarray FROM pg_type t JOIN pg_namespace ns \
             ON typnamespace = ns.oid WHERE typname = 'hstore'",
            &[],
        )
        .unwrap();
        assert!(probe.rows.is_empty(), "hstore really is not installed");
    }

    /// Real Postgres reserves the `pg_` prefix too, so this costs a lesson nothing.
    #[test]
    fn the_reserved_prefixes_are_the_ones_postgres_reserves() {
        assert!(is_internal("pg_type"));
        assert!(is_internal("sqlite_sequence"));
        assert!(!is_internal("accounts"));
        assert!(!is_internal("page_views"), "only the prefix is reserved");
    }
}
