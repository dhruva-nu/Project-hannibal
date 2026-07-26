//! `cannae-sql` — the PostgreSQL emulator (Phase 2, issue #135).
//!
//! Real Postgres clients, drivers and ORMs connect to it unmodified: it speaks wire
//! protocol v3 on `:5432`, both query styles (simple `Query` and the
//! `Parse`/`Bind`/`Describe`/`Execute`/`Sync` flow drivers require), and answers the
//! introspection probes an ORM fires before it will talk. Behind the protocol is SQLite
//! in-memory — a detail the student never meets.
//!
//! What makes it a *lesson prop* rather than a database is the part real Postgres
//! cannot do:
//!
//! - **A scripted mid-transaction crash.** `kill_connection` armed on the debit `UPDATE`
//!   drops the socket between the two writes of a transfer, every time, in the same
//!   place. Whether money survives that is then a fact about the student's code, not
//!   about timing.
//! - **Retryable errors on demand.** `inject_error` with `params.sqlstate` produces a
//!   real serialization failure or deadlock, so a retry lesson has something to retry.
//! - **Transaction state in the op log.** Every statement is recorded with the
//!   transaction state it ran under, which turns "did they wrap both writes?" into an
//!   assertion instead of a guess.
//!
//! It adds only `decode` / `execute` / `apply_fault` / `encode_error` / `matches` plus
//! its registered op classes — how a fault travels from the control plane to the
//! student's socket is the kit's, unchanged since Phase 0.

mod catalog;
mod engine;
mod session;
mod statements;
mod types;
mod wire;

use async_trait::async_trait;
use cannae_core::{ConnState, Emulator, Op, Reader, CONNECT_OP, DISCONNECT_OP};
use engine::Engine;
use serde_json::Value;
use session::Session;
use statements::{READ_VERBS, TRANSACTION_VERBS, VERBS, WRITE_VERBS};
use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard};
use wire::{Out, PgError, Phase};

/// The port real Postgres listens on. Students connect to
/// `postgresql://student:student@db:5432/app` and never learn otherwise.
pub const DEFAULT_PORT: u16 = 5432;

/// Op classes a rule may trigger on, so a lesson can say "on the first write" without
/// naming every verb that writes.
const READ_CLASS: &str = "read";
const WRITE_CLASS: &str = "write";
const TRANSACTION_CLASS: &str = "transaction";
/// Any statement at all — "kill the connection after the Nth statement".
const STATEMENT_CLASS: &str = "statement";
/// Any statement that ran with a transaction block already open. This is the class that
/// expresses "kill it *inside* the transaction" precisely: the trigger reads the state
/// the statement ran under, rather than a lesson author guessing which statement that
/// was.
const IN_TRANSACTION_CLASS: &str = "in_transaction";

const CLASSES: &[&str] = &[
    READ_CLASS,
    WRITE_CLASS,
    TRANSACTION_CLASS,
    STATEMENT_CLASS,
    IN_TRANSACTION_CLASS,
];

pub struct SqlEmulator {
    port: u16,
    engine: Mutex<Engine>,
    /// One session per live connection id. Created when the kit reports `connect` and
    /// dropped when it reports the connection is gone, so a recycled id after `/reset`
    /// can never inherit the previous test case's open transaction.
    sessions: Mutex<HashMap<u64, Session>>,
}

impl SqlEmulator {
    pub fn new() -> Self {
        Self::with_port(DEFAULT_PORT)
    }

    pub fn with_port(port: u16) -> Self {
        SqlEmulator {
            port,
            engine: Mutex::new(Engine::new()),
            sessions: Mutex::new(HashMap::new()),
        }
    }

    fn engine(&self) -> MutexGuard<'_, Engine> {
        self.engine.lock().unwrap()
    }

    fn sessions(&self) -> MutexGuard<'_, HashMap<u64, Session>> {
        self.sessions.lock().unwrap()
    }

    /// Where a connection is in its lifecycle, which decides how the next bytes frame.
    /// An id with no session has not been through `connect` yet, so it is at the start.
    fn phase(&self, conn_id: u64) -> Phase {
        self.sessions()
            .get(&conn_id)
            .map_or(Phase::Startup, Session::phase)
    }

    /// Run `action` against one connection's session, opening it if the kit has not
    /// announced the connection yet.
    ///
    /// The lazy open matters for the `delay` fault: it stalls before `execute`, so an
    /// op can reach here on a connection whose `connect` was answered but whose session
    /// a `/reset` has since cleared.
    fn with_session<T>(&self, conn_id: u64, action: impl FnOnce(&mut Session) -> T) -> T {
        // Opened outside the sessions lock: `open_session` takes the engine lock, and
        // taking the two in different orders in different places is how deadlocks start.
        let mut sessions = self.sessions();
        if !sessions.contains_key(&conn_id) {
            drop(sessions);
            let db = self.engine().open_session();
            sessions = self.sessions();
            sessions.entry(conn_id).or_insert_with(|| Session::new(db));
        }
        action(sessions.get_mut(&conn_id).unwrap())
    }
}

impl Default for SqlEmulator {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Emulator for SqlEmulator {
    fn name(&self) -> &str {
        "sql"
    }

    fn port(&self) -> u16 {
        self.port
    }

    async fn decode(
        &self,
        conn: &mut ConnState,
        reader: &mut Reader,
    ) -> std::io::Result<Option<Op>> {
        // A simple query may carry a batch. Each statement is its own op, so the rest of
        // the batch is drained from the session before the socket is read again.
        if let Some(op) = self.with_session(conn.conn_id, Session::pending_op) {
            return Ok(Some(op));
        }
        // The lock is released before the await: holding it across a read would stall
        // the control plane behind a client that never sends anything.
        let message = match self.phase(conn.conn_id) {
            Phase::Startup => wire::read_startup(reader).await?,
            Phase::Running => wire::read_message(reader).await?,
        };
        let Some(message) = message else {
            return Ok(None);
        };
        Ok(Some(self.with_session(conn.conn_id, |session| {
            session.decode(message)
        })))
    }

    fn op_names(&self) -> &'static [&'static str] {
        // Both halves of what a rule may name: the SQL verbs and the protocol messages.
        // Built once so the two lists cannot drift out of the trigger validation.
        static NAMES: std::sync::OnceLock<Vec<&'static str>> = std::sync::OnceLock::new();
        NAMES.get_or_init(|| {
            let mut names = VERBS.to_vec();
            names.extend(session::PROTOCOL_OPS);
            names
        })
    }

    fn op_classes(&self) -> &'static [&'static str] {
        CLASSES
    }

    fn execute(&self, conn: &mut ConnState, op: &Op) -> Vec<u8> {
        match op.op.as_str() {
            // The kit announces a new connection here. Opening the session now means a
            // `after="connect"` fault ("the database is down") still costs nothing.
            CONNECT_OP => {
                self.with_session(conn.conn_id, |_| ());
                Vec::new()
            }
            DISCONNECT_OP => Vec::new(),
            _ => self.with_session(conn.conn_id, |session| session.run(op)),
        }
    }

    fn end_conn(&self, conn: &ConnState) {
        // Rolling back explicitly is the point: this is the path a `kill_connection`
        // fault takes, and "the uncommitted half of the transfer is gone" is what the
        // banking lesson asserts.
        if let Some(mut session) = self.sessions().remove(&conn.conn_id) {
            session.close_connection();
        }
    }

    fn validate_fault(&self, _action: &str, params: &Value) -> Result<(), String> {
        if let Some(table) = params.get("table") {
            table
                .as_str()
                .ok_or("params.table must be a string".to_string())?;
        }
        if let Some(message) = params.get("message") {
            message
                .as_str()
                .ok_or("params.message must be a string".to_string())?;
        }
        match params.get("sqlstate") {
            None => Ok(()),
            Some(Value::String(code)) if code.len() == 5 => Ok(()),
            // A five-character code is what the standard defines and what every driver
            // matches on; anything else would reach the client as a code it cannot
            // interpret, so it is refused here rather than sent.
            Some(_) => Err("params.sqlstate must be a five-character string".into()),
        }
    }

    fn validate_trigger(
        &self,
        action: &str,
        op_matches: &str,
        params: &Value,
    ) -> Result<(), String> {
        // The SQLSTATE is the whole point of an injected error — a student's `except`
        // clause matches the code, not the message. Defaulting it would hand a lesson a
        // generic internal error and a retry test that never retries.
        if action == INJECT_ERROR && params.get("sqlstate").is_none() {
            return Err(format!(
                "{INJECT_ERROR} on the sql emulator requires params.sqlstate \
                 (e.g. \"40001\" for a retryable serialization failure)"
            ));
        }
        // A table-scoped rule on a trigger that names no table could never match.
        if params.get("table").is_some() && !names_a_table(op_matches) {
            return Err(format!(
                "params.table cannot narrow {op_matches}: that trigger names no table"
            ));
        }
        Ok(())
    }

    /// No protocol-specific *actions* are registered: the four faults Phase 2 needs are
    /// the kit's own (`plans/infra-emulators.md` §4). "Kill after the Nth statement" and
    /// "kill inside a transaction" are `kill_connection` on the `statement` and
    /// `in_transaction` classes; the retryable errors are `inject_error` with a SQLSTATE;
    /// per-statement latency is `delay`. What Phase 2 contributes is what those *look
    /// like on the wire*, which is [`Self::encode_error`] and the classes above.
    fn apply_fault(
        &self,
        action: &str,
        _params: &Value,
        _conn: &mut ConnState,
        _op: &Op,
    ) -> Vec<u8> {
        let mut out = Out::new();
        out.error(&PgError::new(
            engine::INTERNAL_ERROR,
            format!("cannae sql registers no fault action named {action}"),
        ));
        out.finish()
    }

    /// A real `ErrorResponse` — and the transaction abort that must accompany it.
    ///
    /// Postgres aborts the transaction block on *any* error. An injected `40001` that
    /// did not would tell the client its transaction was poisoned while the engine went
    /// on to commit it, so a student who never wrote a retry would pass.
    fn encode_error(&self, conn: &mut ConnState, op: &Op, params: &Value) -> Vec<u8> {
        let field = |name: &str, fallback: &str| {
            params
                .get(name)
                .and_then(Value::as_str)
                .unwrap_or(fallback)
                .to_string()
        };
        let sqlstate = field("sqlstate", engine::INTERNAL_ERROR);
        let message = field("message", &default_message(&sqlstate));
        let error = PgError::new(sqlstate, message);
        self.with_session(conn.conn_id, |session| session.inject_error(&error, op))
    }

    fn op_class_matches(&self, op: &Op, class: &str) -> bool {
        let verb = op.op.as_str();
        let is_statement = VERBS.contains(&verb) || verb == statements::EMPTY_VERB;
        match class {
            READ_CLASS => READ_VERBS.contains(&verb),
            WRITE_CLASS => WRITE_VERBS.contains(&verb),
            TRANSACTION_CLASS => TRANSACTION_VERBS.contains(&verb),
            STATEMENT_CLASS => is_statement,
            // Read off the op the way a grader would, rather than from live session
            // state: the log records the transaction status each statement ran under, so
            // the trigger and the evidence agree by construction.
            IN_TRANSACTION_CLASS => {
                is_statement && op.args.get("in_transaction") == Some(&Value::Bool(true))
            }
            _ => false,
        }
    }

    fn matches(&self, op: &Op, params: &Value) -> bool {
        match params.get("table").and_then(Value::as_str) {
            None => true,
            Some(table) => op
                .args
                .get("tables")
                .and_then(Value::as_array)
                .is_some_and(|tables| tables.iter().any(|touched| touched == table)),
        }
    }

    fn seed(&self, body: &Value) -> Result<(), String> {
        self.engine().load(body)
    }

    fn snapshot(&self) -> Value {
        self.engine().snapshot()
    }

    fn restore(&self, snap: &Value) {
        // Every live session belongs to the test case that just ended: its open
        // transaction, its prepared statements, and — after `/reset` rewinds the counter —
        // its connection id are all about to be reused. Dropping them here is what keeps
        // a recycled id from inheriting an open transaction.
        self.sessions().clear();
        // The only caller is `/reset`, replaying a snapshot this emulator produced. A
        // failure means the two shapes have drifted, which would silently grade against
        // the wrong rows — so it is a hard stop.
        //
        // Abort rather than panic: a panic here unwinds through a control-plane handler
        // holding the engine lock and poisons it, after which every student connection
        // dies with no reply while the process still looks healthy. (Same reasoning as
        // `cannae-cache`'s snapshot guard.)
        if let Err(error) = self.engine().load(snap) {
            eprintln!("cannae sql: a snapshot failed to reload ({error}); aborting");
            std::process::abort();
        }
    }

    fn state(&self) -> Value {
        self.engine().state()
    }
}

/// The generic action whose error frame this emulator supplies.
const INJECT_ERROR: &str = "inject_error";

/// Whether every op a trigger can match names a table. The protocol messages and the
/// transaction verbs do not, so a `params.table` rule on one could never fire.
fn names_a_table(op_matches: &str) -> bool {
    let verb_names_a_table = |verb: &str| {
        (VERBS.contains(&verb) || CLASSES.contains(&verb))
            && !TRANSACTION_VERBS.contains(&verb)
            && verb != TRANSACTION_CLASS
    };
    verb_names_a_table(op_matches)
}

/// The message a well-known SQLSTATE carries in real Postgres. A lesson may override it
/// with `params.message`, but the default should read like the real thing — a student
/// searching the error text should find the same answers.
fn default_message(sqlstate: &str) -> String {
    let message = match sqlstate {
        "40001" => "could not serialize access due to concurrent update",
        "40P01" => "deadlock detected",
        "23505" => "duplicate key value violates unique constraint",
        "23503" => "insert or update on table violates foreign key constraint",
        "23514" => "new row for relation violates check constraint",
        "23502" => "null value in column violates not-null constraint",
        "57P01" => "terminating connection due to administrator command",
        "53300" => "too many clients already",
        "08006" => "connection failure",
        "25P02" => {
            "current transaction is aborted, commands ignored until end of \
                    transaction block"
        }
        _ => "error injected by the cannae harness",
    };
    message.to_string()
}
