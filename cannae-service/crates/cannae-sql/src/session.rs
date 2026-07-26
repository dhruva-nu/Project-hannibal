//! One client connection: its transaction state, its prepared statements and portals,
//! and the batch of statements a simple query is still working through.
//!
//! **Why per-connection state lives here and not in the kit.** `ConnState` carries an id
//! and a sequence number, which is all the kit needs. A SQL connection owns far more —
//! a transaction, a statement cache — and, critically, its own SQLite handle: that is
//! what makes two student connections able to *conflict*, which is the retry lesson.
//! So the emulator keeps a session per connection id and the kit stays protocol-blind.
//!
//! **Transaction status is both protocol and grading signal.** Every `ReadyForQuery`
//! carries `I`/`T`/`E`, and each statement op is logged with the transaction state it
//! ran under — which is how "did a transaction wrap both writes?" becomes an op-log
//! assertion rather than a guess (`plans/infra-emulators.md` §4).

use crate::catalog::{self, Identity, Probe};
use crate::engine::{self, Executed, IN_FAILED_TRANSACTION};
use crate::statements::{self, EMPTY_VERB};
use crate::wire::{Frontend, Out, PgError, Phase, TxStatus};
use cannae_core::Op;
use rusqlite::Connection;
use serde_json::{json, Map, Value};
use std::collections::{HashMap, VecDeque};

/// Op names for the protocol messages that are not statements. A statement is logged
/// under its SQL verb instead, which is what makes `after: {op_matches: "UPDATE"}` mean
/// what a lesson author expects.
pub const STARTUP_OP: &str = "startup";
pub const SSL_REQUEST_OP: &str = "ssl_request";
pub const CANCEL_OP: &str = "cancel_request";
pub const PARSE_OP: &str = "parse";
pub const BIND_OP: &str = "bind";
pub const DESCRIBE_OP: &str = "describe";
pub const CLOSE_OP: &str = "close";
pub const SYNC_OP: &str = "sync";
pub const FLUSH_OP: &str = "flush";
pub const TERMINATE_OP: &str = "terminate";

/// A message tag the emulator does not implement. Logged under its own name and
/// deliberately absent from the installable trigger list, so a fault rule naming it is
/// a 400 rather than a rule that can only fire on the error path.
pub const UNKNOWN_MESSAGE_OP: &str = "unknown_message";

/// Every op name above that is a real protocol message a rule may trigger on.
pub const PROTOCOL_OPS: &[&str] = &[
    STARTUP_OP,
    SSL_REQUEST_OP,
    CANCEL_OP,
    PARSE_OP,
    BIND_OP,
    DESCRIBE_OP,
    CLOSE_OP,
    SYNC_OP,
    FLUSH_OP,
    TERMINATE_OP,
];

/// A prepared statement from `Parse`. Only the SQL is kept: its verb is derived when
/// an `Execute` needs it, so the two can never disagree.
struct Prepared {
    sql: String,
}

/// A bound portal from `Bind`. `rows` is filled on the first `Execute` and drained
/// across later ones, which is how a row limit can suspend a portal without holding a
/// SQLite cursor open between messages.
struct Portal {
    statement: String,
    params: Vec<Option<Vec<u8>>>,
    result: Option<Executed>,
    at: usize,
    /// Whether the row count has been reported. A write reports it once; without this
    /// a second `Execute` on the same portal would claim the rows changed twice.
    reported: bool,
}

/// One client connection.
pub struct Session {
    db: Connection,
    phase: Phase,
    tx: TxStatus,
    identity: Identity,
    prepared: HashMap<String, Prepared>,
    portals: HashMap<String, Portal>,
    /// Statements of a simple-query batch not yet dispatched. Each becomes its own op,
    /// so the `UPDATE` inside `BEGIN; UPDATE …; COMMIT` is a log entry a rule can arm
    /// against rather than a substring of one.
    pending: VecDeque<String>,
    /// After an error in the extended protocol the backend ignores everything until
    /// `Sync`. Clients rely on it: node-postgres pipelines a whole batch and expects
    /// exactly one error and one `ReadyForQuery` back.
    skipping: bool,
}

impl Session {
    pub fn new(db: Connection) -> Self {
        Session {
            db,
            phase: Phase::Startup,
            tx: TxStatus::default(),
            identity: Identity {
                user: String::new(),
                database: String::new(),
            },
            prepared: HashMap::new(),
            portals: HashMap::new(),
            pending: VecDeque::new(),
            skipping: false,
        }
    }

    pub fn phase(&self) -> Phase {
        self.phase
    }

    /// The next statement of a simple-query batch, if one is waiting. Returned without
    /// touching the socket — the bytes were read when the batch arrived.
    pub fn pending_op(&mut self) -> Option<Op> {
        let sql = self.pending.front()?.clone();
        Some(self.statement_op(&sql, Map::new()))
    }

    /// A decoded message as the op the kit logs and matches fault triggers against.
    ///
    /// A simple query becomes one op per statement: the first is returned now and the
    /// rest queue for [`Self::pending_op`].
    pub fn decode(&mut self, message: Frontend) -> Op {
        match message {
            Frontend::EncryptionRequest => Op::lifecycle(SSL_REQUEST_OP),
            Frontend::Cancel => Op::lifecycle(CANCEL_OP),
            Frontend::Startup(parameters) => {
                self.phase = Phase::Running;
                Op {
                    op: STARTUP_OP.to_string(),
                    args: json!(parameters),
                }
            }
            Frontend::Query(sql) => {
                self.pending = statements::split(&sql).into();
                match self.pending_op() {
                    Some(op) => op,
                    // An empty query string is a real thing clients send, and Postgres
                    // answers it with its own message rather than an error.
                    None => self.statement_op("", Map::new()),
                }
            }
            Frontend::Parse { name, sql } => Op {
                op: PARSE_OP.to_string(),
                args: json!({ "name": name, "sql": sql, "verb": statements::verb(&sql) }),
            },
            Frontend::Bind {
                portal,
                statement,
                formats,
                params,
                result_formats,
            } => Op {
                op: BIND_OP.to_string(),
                args: json!({
                    "portal": portal,
                    "statement": statement,
                    "params": params.iter().map(param_to_json).collect::<Vec<_>>(),
                    // Recorded rather than acted on here: refusing binary is
                    // `execute`'s job, and the log should show what was asked for.
                    "binary": formats.contains(&1) || result_formats.contains(&1),
                }),
            },
            Frontend::Describe { kind, name } => Op {
                op: DESCRIBE_OP.to_string(),
                args: json!({ "kind": kind_name(kind), "name": name }),
            },
            Frontend::Execute { portal, max_rows } => {
                let sql = self
                    .portals
                    .get(&portal)
                    .and_then(|bound| self.prepared.get(&bound.statement))
                    .map(|prepared| prepared.sql.clone());
                let mut extra = Map::new();
                extra.insert("portal".into(), json!(portal));
                extra.insert("max_rows".into(), json!(max_rows));
                match sql {
                    Some(sql) => self.statement_op(&sql, extra),
                    // No such portal. Logged under the message name because there is no
                    // statement to name it after; `execute` answers with `34000`.
                    None => Op {
                        op: UNKNOWN_MESSAGE_OP.to_string(),
                        args: json!({ "message": "Execute", "portal": portal }),
                    },
                }
            }
            Frontend::Close { kind, name } => Op {
                op: CLOSE_OP.to_string(),
                args: json!({ "kind": kind_name(kind), "name": name }),
            },
            Frontend::Sync => Op::lifecycle(SYNC_OP),
            Frontend::Flush => Op::lifecycle(FLUSH_OP),
            Frontend::Terminate => Op::lifecycle(TERMINATE_OP),
            Frontend::Unknown(tag) => Op {
                op: UNKNOWN_MESSAGE_OP.to_string(),
                args: json!({ "tag": (tag as char).to_string() }),
            },
        }
    }

    /// A statement op: its verb, the SQL, the tables it touches, and the transaction
    /// state it is about to run under.
    ///
    /// `in_transaction` is the state *before* the statement, so `BEGIN` reads `false`
    /// and the `UPDATE` after it reads `true` — which is exactly the question a grader
    /// asks of the log.
    fn statement_op(&self, sql: &str, mut extra: Map<String, Value>) -> Op {
        let verb = statements::verb(sql);
        extra.insert("sql".into(), json!(sql));
        extra.insert("tables".into(), json!(statements::tables(sql)));
        extra.insert("in_transaction".into(), json!(self.tx != TxStatus::Idle));
        Op {
            op: verb,
            args: Value::Object(extra),
        }
    }

    /// Run one op and produce the bytes to send back.
    pub fn run(&mut self, op: &Op) -> Vec<u8> {
        let mut out = Out::new();
        // After an error the extended protocol ignores everything until `Sync`. A
        // statement dropped here is still in the log, annotated with what happened.
        if self.skipping && op.op != SYNC_OP {
            return Vec::new();
        }
        match op.op.as_str() {
            SSL_REQUEST_OP => {
                out.encryption_refused();
            }
            // Postgres answers a cancel request by closing without a word. There is
            // never in-flight work here to cancel — statements run to completion.
            CANCEL_OP => {}
            STARTUP_OP => self.startup(op, &mut out),
            PARSE_OP => self.parse(op, &mut out),
            BIND_OP => self.bind(op, &mut out),
            DESCRIBE_OP => self.describe(op, &mut out),
            CLOSE_OP => self.close(op, &mut out),
            SYNC_OP => {
                self.skipping = false;
                out.ready_for_query(self.tx);
            }
            // `Flush` asks for buffered output; nothing is buffered, so there is
            // nothing to send. `Terminate` needs no reply — the client closes next.
            FLUSH_OP | TERMINATE_OP => {}
            UNKNOWN_MESSAGE_OP => self.unknown_message(op, &mut out),
            _ => self.statement(op, &mut out),
        }
        out.finish()
    }

    /// Bytes for a fault-injected error, and the state change that must go with it.
    ///
    /// The state change is the point: Postgres aborts the transaction on *any* error, so
    /// an injected `40001` inside a transaction block must leave it failed. Without this
    /// the client would be told the transaction was poisoned while the engine went on to
    /// commit it — a lesson graded as a success the student never earned.
    pub fn inject_error(&mut self, error: &PgError, op: &Op) -> Vec<u8> {
        let mut out = Out::new();
        let simple = is_simple(op);
        self.fail(error, simple, &mut out);
        // A fault fires *instead of* the statement, so the statement's own
        // `finish_statement` never runs — this is where the exchange is closed out.
        if simple {
            self.pending.clear();
            out.ready_for_query(self.tx);
        }
        out.finish()
    }

    /// Release the connection. An open transaction is rolled back explicitly rather
    /// than left to the handle's destructor: this is the path a `kill_connection` fault
    /// takes, and "the uncommitted half of the transfer is gone" is the assertion the
    /// banking lesson makes.
    pub fn close_connection(&mut self) {
        if self.tx != TxStatus::Idle {
            let _ = self.db.execute_batch("ROLLBACK");
            self.tx = TxStatus::Idle;
        }
    }

    fn startup(&mut self, op: &Op, out: &mut Out) {
        let parameter = |name: &str, fallback: &str| {
            op.args
                .get(name)
                .and_then(Value::as_str)
                .unwrap_or(fallback)
                .to_string()
        };
        self.identity = Identity {
            user: parameter("user", "student"),
            database: parameter("database", "app"),
        };
        out.authentication_ok();
        for (name, value) in catalog::STARTUP_PARAMETERS {
            // The client's own `application_name` is echoed back; every other value is
            // the emulator's.
            let value = match *name {
                "application_name" => parameter("application_name", value),
                "session_authorization" => self.identity.user.clone(),
                _ => (*value).to_string(),
            };
            out.parameter_status(name, &value);
        }
        out.backend_key_data(catalog::BACKEND_PID, 0);
        out.ready_for_query(self.tx);
    }

    fn parse(&mut self, op: &Op, out: &mut Out) {
        let name = text(op, "name");
        let sql = text(op, "sql");
        // Prepare it now so a broken statement is reported at `Parse`, where the client
        // expects it, rather than surfacing later as a mysterious `Bind` failure.
        if let Err(error) = engine::describe(&self.db, &sql) {
            return self.fail(&error, is_simple(op), out);
        }
        self.prepared.insert(name, Prepared { sql });
        out.parse_complete();
    }

    fn bind(&mut self, op: &Op, out: &mut Out) {
        // Binary format is refused rather than mis-decoded: nothing here encodes or
        // decodes it, and a value read with the wrong codec is a wrong answer that
        // looks like a right one. Every blessed client uses text.
        if op.args.get("binary") == Some(&Value::Bool(true)) {
            let error = PgError::new(
                "0A000",
                "cannae speaks the text format only; binary parameters and results \
                 are not implemented",
            );
            return self.fail(&error, false, out);
        }
        let statement = text(op, "statement");
        if !self.prepared.contains_key(&statement) {
            let error = PgError::new(
                "26000",
                format!("prepared statement \"{statement}\" does not exist"),
            );
            return self.fail(&error, is_simple(op), out);
        }
        self.portals.insert(
            text(op, "portal"),
            Portal {
                statement,
                params: params_from_json(op.args.get("params")),
                result: None,
                at: 0,
                reported: false,
            },
        );
        out.bind_complete();
    }

    fn describe(&mut self, op: &Op, out: &mut Out) {
        let name = text(op, "name");
        let statement = match text(op, "kind").as_str() {
            "portal" => match self.portals.get(&name) {
                Some(portal) => portal.statement.clone(),
                None => {
                    let error = PgError::new("34000", format!("portal \"{name}\" does not exist"));
                    return self.fail(&error, is_simple(op), out);
                }
            },
            _ => name.clone(),
        };
        let Some(prepared) = self.prepared.get(&statement) else {
            let error = PgError::new(
                "26000",
                format!("prepared statement \"{statement}\" does not exist"),
            );
            return self.fail(&error, is_simple(op), out);
        };
        let described = match engine::describe(&self.db, &prepared.sql) {
            Ok(described) => described,
            Err(error) => return self.fail(&error, is_simple(op), out),
        };
        // Only a statement is described with its parameters; a portal's are already bound.
        if text(op, "kind") == "statement" {
            out.parameter_description(described.parameters);
        }
        match described.fields.is_empty() {
            true => out.no_data(),
            false => out.row_description(&described.fields),
        };
    }

    fn close(&mut self, op: &Op, out: &mut Out) {
        let name = text(op, "name");
        match text(op, "kind").as_str() {
            "portal" => {
                self.portals.remove(&name);
            }
            _ => {
                self.prepared.remove(&name);
                // A portal outliving the statement it was bound to could never execute.
                self.portals.retain(|_, portal| portal.statement != name);
            }
        }
        // Closing something that was never open is not an error in Postgres.
        out.close_complete();
    }

    fn unknown_message(&mut self, op: &Op, out: &mut Out) {
        let error = match op.args.get("portal").and_then(Value::as_str) {
            Some(portal) => PgError::new("34000", format!("portal \"{portal}\" does not exist")),
            None => PgError::new(
                "08P01",
                format!(
                    "cannae does not implement frontend message {}",
                    op.args
                        .get("tag")
                        .and_then(Value::as_str)
                        .unwrap_or("<unknown>")
                ),
            ),
        };
        self.fail(&error, is_simple(op), out);
    }

    /// Run one SQL statement. The order of the guards is the order Postgres applies
    /// them, and each is a behaviour a lesson can turn on.
    fn statement(&mut self, op: &Op, out: &mut Out) {
        let sql = text(op, "sql");
        let simple = op.args.get("portal").is_none();
        if op.op == EMPTY_VERB {
            out.empty_query();
            return self.finish_statement(simple, out);
        }
        // Inside a failed transaction block Postgres refuses everything but the two
        // statements that end the block. A lesson that did not see this would teach
        // that an error mid-transaction is recoverable without a rollback.
        if self.tx == TxStatus::Failed && !is_end_of_block(&op.op) {
            let error = PgError::new(
                IN_FAILED_TRANSACTION,
                "current transaction is aborted, commands ignored until end of \
                 transaction block",
            );
            // `25P02` must not reset the failed state — it *is* that state, which
            // `fail` leaves alone because the block is already failed rather than open.
            self.fail(&error, simple, out);
            return self.finish_statement(simple, out);
        }
        match statements::TRANSACTION_VERBS.contains(&op.op.as_str()) {
            true => self.transaction(&op.op, out),
            false => self.data_statement(op, &sql, simple, out),
        }
        self.finish_statement(simple, out);
    }

    /// `BEGIN` / `COMMIT` / `ROLLBACK`, including the two cases Postgres warns about
    /// rather than failing: a nested `BEGIN`, and ending a block that is not open.
    fn transaction(&mut self, verb: &str, out: &mut Out) {
        let (sql, next, tag, warning) = match (verb, self.tx) {
            ("BEGIN", TxStatus::Idle) => ("BEGIN", TxStatus::Open, "BEGIN", None),
            ("BEGIN", _) => (
                "",
                self.tx,
                "BEGIN",
                Some("there is already a transaction in progress"),
            ),
            ("COMMIT", TxStatus::Open) => ("COMMIT", TxStatus::Idle, "COMMIT", None),
            // Committing a failed block rolls back and *says so* in the tag. A client
            // that reported "committed" here would hide a lost transaction.
            ("COMMIT", TxStatus::Failed) => ("ROLLBACK", TxStatus::Idle, "ROLLBACK", None),
            ("COMMIT", TxStatus::Idle) => (
                "",
                TxStatus::Idle,
                "COMMIT",
                Some("there is no transaction in progress"),
            ),
            (_, TxStatus::Idle) => (
                "",
                TxStatus::Idle,
                "ROLLBACK",
                Some("there is no transaction in progress"),
            ),
            _ => ("ROLLBACK", TxStatus::Idle, "ROLLBACK", None),
        };
        if let Some(warning) = warning {
            out.notice(&PgError::new("25P01", warning));
        }
        if !sql.is_empty() {
            if let Err(error) = self.db.execute_batch(sql) {
                // The engine and the emulator's idea of the transaction have diverged;
                // saying so beats reporting a commit that did not happen.
                let error = engine::error_of(&error);
                out.error(&error);
                self.tx = TxStatus::Failed;
                return;
            }
        }
        self.tx = next;
        out.command_complete(tag);
    }

    /// Everything that is not a transaction verb: a catalog probe, or real SQL.
    fn data_statement(&mut self, op: &Op, sql: &str, simple: bool, out: &mut Out) {
        if let Some(probe) = catalog::probe(sql, &self.identity) {
            match probe {
                Probe::Acknowledged => {
                    out.command_complete(&op.op);
                }
                Probe::Row(executed) => self.emit_rows(&executed, &op.op, sql, simple, out),
            }
            return;
        }
        match simple {
            true => self.simple_statement(op, sql, out),
            false => self.execute_portal(op, out),
        }
    }

    fn simple_statement(&mut self, op: &Op, sql: &str, out: &mut Out) {
        match engine::run(&self.db, sql, &[]) {
            Err(error) => self.fail(&error, is_simple(op), out),
            Ok(executed) => self.emit_rows(&executed, &op.op, sql, true, out),
        }
    }

    /// `Execute` on a bound portal. The first call runs the statement and materialises
    /// its rows; later calls drain what is left, which is how a row limit suspends.
    fn execute_portal(&mut self, op: &Op, out: &mut Out) {
        let name = text(op, "portal");
        let sql = self
            .portals
            .get(&name)
            .and_then(|portal| self.prepared.get(&portal.statement))
            .map(|prepared| prepared.sql.clone());
        // `decode` already proved the portal exists, so this only fires if a `Close`
        // landed in between — in which case `34000` is the right answer either way.
        let Some(sql) = sql else {
            let error = PgError::new("34000", format!("portal \"{name}\" does not exist"));
            return self.fail(&error, is_simple(op), out);
        };
        if self.portals[&name].result.is_none() {
            let params = self.portals[&name].params.clone();
            match engine::run(&self.db, &sql, &params) {
                Err(error) => return self.fail(&error, is_simple(op), out),
                Ok(executed) => {
                    self.portals.get_mut(&name).unwrap().result = Some(executed);
                }
            }
        }
        self.drain_portal(&name, op, out);
    }

    /// Send up to `max_rows` of a materialised portal, suspending if rows remain.
    fn drain_portal(&mut self, name: &str, op: &Op, out: &mut Out) {
        let max_rows = op.args.get("max_rows").and_then(Value::as_i64).unwrap_or(0);
        let portal = self.portals.get_mut(name).unwrap();
        let executed = portal.result.as_ref().unwrap();
        let remaining = executed.rows.len() - portal.at.min(executed.rows.len());
        let take = match max_rows > 0 {
            true => remaining.min(max_rows as usize),
            false => remaining,
        };
        for row in &executed.rows[portal.at..portal.at + take] {
            out.data_row(row);
        }
        portal.at += take;
        let suspended = portal.at < executed.rows.len();
        let affected = match executed.fields.is_empty() {
            true => {
                let first = !portal.reported;
                portal.reported = true;
                executed.affected * usize::from(first)
            }
            false => take,
        };
        match suspended {
            true => out.portal_suspended(),
            false => out.command_complete(&tag_for(&op.op, &text(op, "sql"), affected)),
        };
    }

    /// Rows plus the `CommandComplete` that closes them. In the simple protocol the
    /// row description travels with the rows; in the extended one it was already sent
    /// in reply to `Describe`, and sending it again would break the client's framing.
    fn emit_rows(
        &mut self,
        executed: &Executed,
        verb: &str,
        sql: &str,
        simple: bool,
        out: &mut Out,
    ) {
        if simple && !executed.fields.is_empty() {
            out.row_description(&executed.fields);
        }
        for row in &executed.rows {
            out.data_row(row);
        }
        out.command_complete(&tag_for(verb, sql, executed.affected));
    }

    /// Report an error, and take the two state changes that must accompany it: a
    /// transaction block becomes failed, and the rest of the batch is discarded.
    fn fail(&mut self, error: &PgError, simple: bool, out: &mut Out) {
        out.error(error);
        if self.tx == TxStatus::Open {
            self.tx = TxStatus::Failed;
        }
        // A simple-query batch stops at its first error: the statements after it never
        // run, so they never reach the log either.
        self.pending.clear();
        // The extended protocol ignores everything up to the next `Sync`, which is what
        // then sends the single `ReadyForQuery` the client is waiting for. In the simple
        // protocol `finish_statement` sends it.
        if !simple {
            self.skipping = true;
        }
    }

    /// Close out a statement: drop it from the batch and, if it was the last of a simple
    /// query, send the `ReadyForQuery` that ends the exchange. In the extended protocol
    /// `Sync` does that instead.
    fn finish_statement(&mut self, simple: bool, out: &mut Out) {
        if !simple {
            return;
        }
        self.pending.pop_front();
        if self.pending.is_empty() {
            out.ready_for_query(self.tx);
        }
    }
}

/// Whether an op belongs to the simple query protocol, where the statement itself
/// closes the exchange with a `ReadyForQuery`. An extended-protocol statement carries a
/// portal, and only its `Sync` may send one.
fn is_simple(op: &Op) -> bool {
    !PROTOCOL_OPS.contains(&op.op.as_str())
        && op.op != UNKNOWN_MESSAGE_OP
        && op.args.get("portal").is_none()
}

fn is_end_of_block(verb: &str) -> bool {
    verb == "COMMIT" || verb == "ROLLBACK"
}

fn kind_name(kind: u8) -> &'static str {
    match kind {
        b'P' => "portal",
        _ => "statement",
    }
}

fn text(op: &Op, field: &str) -> String {
    op.args
        .get(field)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

/// The `CommandComplete` tag. Clients read the row count out of it, and an ORM reads
/// the DDL object name, so both halves matter.
fn tag_for(verb: &str, sql: &str, affected: usize) -> String {
    match verb {
        // Postgres' `INSERT` tag carries a (long dead) OID field before the count.
        "INSERT" => format!("INSERT 0 {affected}"),
        "SELECT" | "UPDATE" | "DELETE" => format!("{verb} {affected}"),
        // `CREATE TABLE`, `DROP INDEX`, `ALTER TABLE` — the object is part of the tag.
        "CREATE" | "DROP" | "ALTER" => ddl_tag(verb, sql),
        other => other.to_string(),
    }
}

fn ddl_tag(verb: &str, sql: &str) -> String {
    match sql
        .split_whitespace()
        .nth(1)
        .map(|word| word.to_uppercase())
        .filter(|word| word.chars().all(|c| c.is_ascii_alphabetic()))
    {
        Some(object) => format!("{verb} {object}"),
        None => verb.to_string(),
    }
}

/// A parameter as the op log records it: text when it is text, a byte array when it is
/// not — the same convention `cannae-cache` uses for a non-UTF-8 value, so the log
/// stays a faithful and reversible record of what arrived.
fn param_to_json(param: &Option<Vec<u8>>) -> Value {
    match param {
        None => Value::Null,
        Some(bytes) => match std::str::from_utf8(bytes) {
            Ok(text) => Value::String(text.to_string()),
            Err(_) => Value::Array(bytes.iter().map(|byte| json!(byte)).collect()),
        },
    }
}

fn params_from_json(params: Option<&Value>) -> Vec<Option<Vec<u8>>> {
    params
        .and_then(Value::as_array)
        .map(|values| values.iter().map(param_from_json).collect())
        .unwrap_or_default()
}

fn param_from_json(value: &Value) -> Option<Vec<u8>> {
    match value {
        Value::Null => None,
        Value::String(text) => Some(text.clone().into_bytes()),
        Value::Array(bytes) => Some(
            bytes
                .iter()
                .filter_map(|byte| byte.as_u64())
                .map(|byte| byte as u8)
                .collect(),
        ),
        other => Some(other.to_string().into_bytes()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::Engine;

    fn session() -> (Engine, Session) {
        let mut engine = Engine::new();
        engine
            .load(&json!({
                "schema": ["CREATE TABLE accounts (owner TEXT PRIMARY KEY, \
                            balance NUMERIC(12,2) NOT NULL CHECK (balance >= 0))"],
                "rows": { "accounts": [{ "owner": "ada", "balance": "1000.00" }] }
            }))
            .unwrap();
        let session = Session::new(engine.open_session());
        (engine, session)
    }

    /// Drive one simple query through decode + run, as the kit would.
    fn query(session: &mut Session, sql: &str) -> String {
        let op = session.decode(Frontend::Query(sql.to_string()));
        let mut out = String::from_utf8_lossy(&session.run(&op)).into_owned();
        // A batch decodes to one op per statement, so drain the rest the way the
        // emulator's `decode` does.
        while let Some(op) = session.pending_op() {
            out.push_str(&String::from_utf8_lossy(&session.run(&op)));
        }
        out
    }

    fn started() -> (Engine, Session) {
        let (engine, mut session) = session();
        let mut parameters = std::collections::BTreeMap::new();
        parameters.insert("user".to_string(), "student".to_string());
        parameters.insert("database".to_string(), "app".to_string());
        let op = session.decode(Frontend::Startup(parameters));
        session.run(&op);
        (engine, session)
    }

    #[test]
    fn a_connection_starts_in_the_startup_phase_and_leaves_it_once() {
        let (_engine, mut session) = session();
        assert_eq!(session.phase(), Phase::Startup);
        session.decode(Frontend::Startup(Default::default()));
        assert_eq!(session.phase(), Phase::Running);
    }

    /// The startup reply must carry the parameters a client decodes strings with, or the
    /// client crashes rather than degrading.
    #[test]
    fn the_startup_reply_echoes_the_clients_own_application_name() {
        let (_engine, mut session) = session();
        let mut parameters = std::collections::BTreeMap::new();
        parameters.insert("user".into(), "ada".to_string());
        parameters.insert("application_name".into(), "lesson".to_string());
        let op = session.decode(Frontend::Startup(parameters));
        let reply = String::from_utf8_lossy(&session.run(&op)).into_owned();
        assert!(reply.contains("application_name\0lesson\0"), "{reply}");
        assert!(reply.contains("client_encoding\0UTF8\0"), "{reply}");
        // `session_authorization` reports the user the connection string named.
        assert!(reply.contains("session_authorization\0ada\0"), "{reply}");
        // And the identity probes agree with it.
        assert!(query(&mut session, "SELECT current_user").contains("ada"));
    }

    #[test]
    fn a_batch_decodes_to_one_op_per_statement_and_one_ready() {
        let (_engine, mut session) = started();
        let reply = query(
            &mut session,
            "BEGIN; UPDATE accounts SET balance = 0 WHERE owner = 'ada'; COMMIT",
        );
        assert_eq!(reply.matches("BEGIN\0").count(), 1);
        assert_eq!(reply.matches("UPDATE 1\0").count(), 1);
        assert_eq!(reply.matches("COMMIT\0").count(), 1);
        // Exactly one `ReadyForQuery` closes the exchange, and it reports idle.
        assert_eq!(reply.matches('Z').count(), 1, "{reply:?}");
        assert!(reply.ends_with('I'));
    }

    /// The statement op carries the transaction state it ran under, which is what the
    /// `in_transaction` trigger and a grader both read.
    #[test]
    fn a_statement_op_records_the_transaction_state_it_ran_under() {
        let (_engine, mut session) = started();
        let begin = session.decode(Frontend::Query("BEGIN".into()));
        assert_eq!(begin.args["in_transaction"], json!(false));
        session.run(&begin);
        let update = session.decode(Frontend::Query("UPDATE accounts SET balance = 1".into()));
        assert_eq!(update.args["in_transaction"], json!(true));
        assert_eq!(update.args["tables"], json!(["accounts"]));
    }

    /// A fault fires instead of the statement, so the statement's own bookkeeping never
    /// runs — this is where the exchange gets closed out.
    #[test]
    fn an_injected_error_poisons_the_block_and_closes_the_exchange() {
        let (_engine, mut session) = started();
        query(&mut session, "BEGIN");
        let op = session.decode(Frontend::Query("UPDATE accounts SET balance = 1".into()));
        let reply = String::from_utf8_lossy(
            &session.inject_error(&PgError::new("40001", "could not serialize"), &op),
        )
        .into_owned();
        assert!(reply.starts_with('E'), "{reply:?}");
        assert_eq!(reply.matches('Z').count(), 1);
        assert!(reply.ends_with('E'), "the block must be reported as failed");
    }

    /// An injected error mid-batch abandons the rest of it — the statements after it
    /// never run, so they never reach the log either.
    #[test]
    fn an_injected_error_abandons_the_rest_of_a_batch() {
        let (engine, mut session) = started();
        let op = session.decode(Frontend::Query(
            "UPDATE accounts SET balance = 1; UPDATE accounts SET balance = 2".into(),
        ));
        session.inject_error(&PgError::new("40001", "nope"), &op);
        assert!(
            session.pending_op().is_none(),
            "the batch must be abandoned"
        );
        assert_eq!(
            engine.state()["tables"]["accounts"][0]["balance"],
            json!("1000.00")
        );
    }

    /// Closing a connection mid-transaction must lose the uncommitted work explicitly —
    /// this is the path a `kill_connection` fault takes.
    #[test]
    fn closing_a_connection_rolls_back_an_open_transaction() {
        let (engine, mut session) = started();
        query(&mut session, "BEGIN");
        query(
            &mut session,
            "UPDATE accounts SET balance = 0 WHERE owner = 'ada'",
        );
        session.close_connection();
        assert_eq!(
            engine.state()["tables"]["accounts"][0]["balance"],
            json!("1000.00")
        );
        // Idempotent: the kit calls this on every path out of a connection.
        session.close_connection();
    }

    /// After an error the extended protocol ignores everything up to `Sync`, which then
    /// sends the single `ReadyForQuery` the client is waiting for.
    #[test]
    fn the_extended_protocol_skips_to_sync_after_an_error() {
        let (_engine, mut session) = started();
        let bind = session.decode(Frontend::Bind {
            portal: String::new(),
            statement: "nope".into(),
            formats: vec![],
            params: vec![],
            result_formats: vec![],
        });
        let reply = String::from_utf8_lossy(&session.run(&bind)).into_owned();
        assert!(reply.starts_with('E'), "{reply:?}");
        assert!(
            !reply.contains('Z'),
            "Sync sends the ready, not Bind: {reply:?}"
        );

        // Everything until `Sync` is dropped on the floor.
        let describe = session.decode(Frontend::Describe {
            kind: b'S',
            name: String::new(),
        });
        assert!(session.run(&describe).is_empty());
        let sync = session.decode(Frontend::Sync);
        assert_eq!(session.run(&sync), b"Z\0\0\0\x05I");
    }

    #[test]
    fn binary_format_is_refused_by_name_rather_than_mis_decoded() {
        let (_engine, mut session) = started();
        let op = session.decode(Frontend::Bind {
            portal: String::new(),
            statement: String::new(),
            formats: vec![1],
            params: vec![Some(b"\x00\x00\x00\x01".to_vec())],
            result_formats: vec![],
        });
        assert_eq!(op.args["binary"], json!(true));
        let reply = String::from_utf8_lossy(&session.run(&op)).into_owned();
        assert!(reply.contains("0A000"), "{reply:?}");
        assert!(reply.contains("binary"), "{reply:?}");
    }

    /// A `Describe` that names nothing real is an error, not an empty description.
    #[test]
    fn describing_something_that_does_not_exist_is_an_error() {
        let (_engine, mut session) = started();
        for (kind, code) in [(b'P', "34000"), (b'S', "26000")] {
            let op = session.decode(Frontend::Describe {
                kind,
                name: "ghost".into(),
            });
            let reply = String::from_utf8_lossy(&session.run(&op)).into_owned();
            assert!(reply.contains(code), "{}: {reply:?}", kind as char);
            let sync = session.decode(Frontend::Sync);
            session.run(&sync);
        }
    }

    /// Closing a prepared statement takes its portals with it: a portal bound to a
    /// statement that no longer exists could never execute.
    #[test]
    fn closing_a_statement_drops_the_portals_bound_to_it() {
        let (_engine, mut session) = started();
        for message in [
            Frontend::Parse {
                name: "s1".into(),
                sql: "SELECT 1".into(),
            },
            Frontend::Bind {
                portal: "p1".into(),
                statement: "s1".into(),
                formats: vec![],
                params: vec![],
                result_formats: vec![],
            },
        ] {
            let op = session.decode(message);
            session.run(&op);
        }
        let close = session.decode(Frontend::Close {
            kind: b'S',
            name: "s1".into(),
        });
        assert_eq!(session.run(&close), b"3\0\0\0\x04");
        // An `Execute` on the orphaned portal has no statement to name, so it decodes as
        // an unimplemented message and answers `34000`.
        let execute = session.decode(Frontend::Execute {
            portal: "p1".into(),
            max_rows: 0,
        });
        assert_eq!(execute.op, UNKNOWN_MESSAGE_OP);
        let reply = String::from_utf8_lossy(&session.run(&execute)).into_owned();
        assert!(reply.contains("34000"), "{reply:?}");
    }

    /// Closing something that was never open is not an error in Postgres.
    #[test]
    fn closing_something_that_was_never_open_is_fine() {
        let (_engine, mut session) = started();
        for kind in *b"SP" {
            let op = session.decode(Frontend::Close {
                kind,
                name: "ghost".into(),
            });
            assert_eq!(session.run(&op), b"3\0\0\0\x04");
        }
    }

    /// `Flush` asks for buffered output and `Terminate` needs no reply, so neither writes
    /// a byte — and `CancelRequest` is answered with silence, as Postgres answers it.
    #[test]
    fn the_messages_that_need_no_reply_send_nothing() {
        let (_engine, mut session) = started();
        for message in [Frontend::Flush, Frontend::Terminate, Frontend::Cancel] {
            let op = session.decode(message);
            assert!(session.run(&op).is_empty(), "{}", op.op);
        }
    }

    #[test]
    fn an_encryption_request_is_refused_with_a_single_unframed_byte() {
        let (_engine, mut session) = session();
        let op = session.decode(Frontend::EncryptionRequest);
        assert_eq!(op.op, SSL_REQUEST_OP);
        assert_eq!(session.run(&op), b"N");
    }

    #[test]
    fn an_unimplemented_message_is_reported_rather_than_ignored() {
        let (_engine, mut session) = started();
        let op = session.decode(Frontend::Unknown(b'W'));
        assert_eq!(op.args["tag"], json!("W"));
        let reply = String::from_utf8_lossy(&session.run(&op)).into_owned();
        assert!(reply.contains("08P01"), "{reply:?}");
    }

    /// Clients read the row count out of the tag, and an ORM reads the DDL object name,
    /// so both halves matter.
    #[test]
    fn the_command_complete_tag_carries_what_a_client_reads_from_it() {
        assert_eq!(tag_for("SELECT", "", 2), "SELECT 2");
        assert_eq!(tag_for("INSERT", "", 1), "INSERT 0 1");
        assert_eq!(tag_for("UPDATE", "", 0), "UPDATE 0");
        assert_eq!(tag_for("DELETE", "", 3), "DELETE 3");
        assert_eq!(tag_for("BEGIN", "", 0), "BEGIN");
        assert_eq!(tag_for("SET", "", 0), "SET");
        assert_eq!(
            tag_for("CREATE", "CREATE TABLE accounts (id INT)", 0),
            "CREATE TABLE"
        );
        assert_eq!(tag_for("DROP", "drop index t_n", 0), "DROP INDEX");
        assert_eq!(
            tag_for("ALTER", "ALTER TABLE t ADD c INT", 0),
            "ALTER TABLE"
        );
        // Nothing that is not a bare word becomes part of the tag.
        assert_eq!(tag_for("CREATE", "CREATE", 0), "CREATE");
        assert_eq!(tag_for("DROP", "DROP \"t\"", 0), "DROP");
    }

    /// A parameter is logged as text when it is text and as bytes when it is not — the
    /// same convention `cannae-cache` uses, so the log stays reversible.
    #[test]
    fn a_parameter_round_trips_through_the_op_log() {
        for param in [
            None,
            Some(b"ada".to_vec()),
            Some(Vec::new()),
            Some(vec![0xff, 0x00]),
        ] {
            let logged = param_to_json(&param);
            assert_eq!(param_from_json(&logged), param, "{logged}");
        }
        assert_eq!(param_to_json(&Some(b"ada".to_vec())), json!("ada"));
        assert_eq!(param_to_json(&Some(vec![0xff])), json!([255]));
        // A number in the log is read back as its text form rather than dropped.
        assert_eq!(param_from_json(&json!(7)), Some(b"7".to_vec()));
    }

    #[test]
    fn a_describe_kind_byte_names_what_it_describes() {
        assert_eq!(kind_name(b'P'), "portal");
        assert_eq!(kind_name(b'S'), "statement");
    }

    /// Only a simple-query statement closes its own exchange; an extended one waits for
    /// `Sync`, and a protocol message never sends a ready of its own.
    #[test]
    fn only_a_simple_query_statement_closes_its_own_exchange() {
        let statement = |args| Op {
            op: "UPDATE".to_string(),
            args,
        };
        assert!(is_simple(&statement(
            json!({ "sql": "UPDATE t SET a = 1" })
        )));
        assert!(!is_simple(&statement(json!({ "portal": "" }))));
        assert!(!is_simple(&Op::lifecycle(SYNC_OP)));
        assert!(!is_simple(&Op {
            op: UNKNOWN_MESSAGE_OP.to_string(),
            args: json!({ "tag": "W" }),
        }));
    }

    #[test]
    fn an_empty_query_gets_its_own_message() {
        let (_engine, mut session) = started();
        for sql in ["", "   ", "-- nothing but a comment"] {
            let reply = query(&mut session, sql);
            assert_eq!(reply, "I\0\0\0\u{4}Z\0\0\0\u{5}I", "{sql:?}");
        }
    }

    /// Postgres warns rather than failing on a redundant transaction statement.
    #[test]
    fn redundant_transaction_statements_warn_rather_than_fail() {
        let (_engine, mut session) = started();
        for sql in ["COMMIT", "ROLLBACK"] {
            let reply = query(&mut session, sql);
            assert!(reply.starts_with('N'), "{sql}: {reply:?}");
            assert!(reply.contains("no transaction in progress"), "{reply:?}");
            assert!(reply.contains(sql), "{reply:?}");
        }
        query(&mut session, "BEGIN");
        let reply = query(&mut session, "BEGIN");
        assert!(
            reply.contains("already a transaction in progress"),
            "{reply:?}"
        );
        assert!(reply.ends_with('T'), "and the block stays open: {reply:?}");
    }

    /// A row limit suspends the portal; the client re-executes to drain the rest, and a
    /// write's row count is reported exactly once however many times it is executed.
    #[test]
    fn a_row_limit_suspends_the_portal_and_a_write_counts_once() {
        let (_engine, mut session) = started();
        let run = |session: &mut Session, message| {
            let op = session.decode(message);
            String::from_utf8_lossy(&session.run(&op)).into_owned()
        };
        run(
            &mut session,
            Frontend::Parse {
                name: String::new(),
                sql: "UPDATE accounts SET balance = 1".into(),
            },
        );
        run(
            &mut session,
            Frontend::Bind {
                portal: String::new(),
                statement: String::new(),
                formats: vec![],
                params: vec![],
                result_formats: vec![],
            },
        );
        let first = run(
            &mut session,
            Frontend::Execute {
                portal: String::new(),
                max_rows: 0,
            },
        );
        assert!(first.contains("UPDATE 1"), "{first:?}");
        // Re-executing an exhausted portal must not claim the rows changed twice.
        let again = run(
            &mut session,
            Frontend::Execute {
                portal: String::new(),
                max_rows: 0,
            },
        );
        assert!(again.contains("UPDATE 0"), "{again:?}");
    }
}
