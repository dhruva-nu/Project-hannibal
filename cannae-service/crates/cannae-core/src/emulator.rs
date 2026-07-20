//! The kit/protocol seam. A protocol emulator implements [`Emulator`]; the kit
//! drives the connection lifecycle and the fault pipeline around it.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io;
use tokio::io::BufReader;
use tokio::net::tcp::OwnedReadHalf;

/// Every emulator speaks a wire protocol over TCP, so the read side is the same
/// concrete type for all of them — which keeps [`Emulator`] object-safe.
pub type Reader = BufReader<OwnedReadHalf>;

/// One protocol-level operation, as it appears in the op log and as fault triggers
/// match against it. `op` is the type (`ECHO`, `UPDATE`, `deliver`, `connect`, …).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Op {
    pub op: String,
    pub args: Value,
}

impl Op {
    /// A lifecycle op the kit emits itself (`connect` / `disconnect`) — these are
    /// first-class log entries and valid fault triggers.
    pub fn lifecycle(op: &str) -> Self {
        Self {
            op: op.to_string(),
            args: Value::Null,
        }
    }
}

/// Per-connection state the kit owns and threads through the emulator's callbacks.
pub struct ConnState {
    pub conn_id: u64,
    pub seq: u64,
}

/// A protocol emulator. The kit owns trigger matching and the connection loop; the
/// emulator owns framing (`decode`), semantics (`execute`), and how its faults look
/// on the wire (`apply_fault` / `encode_error`).
#[async_trait]
pub trait Emulator: Send + Sync {
    /// Emulator name — matches the `emulator` field of a fault rule and the
    /// `?emulator=` query on the control API.
    fn name(&self) -> &str;

    /// The standard port this protocol listens on.
    fn port(&self) -> u16;

    /// Decode exactly one client operation from the stream. `Ok(None)` on clean EOF.
    async fn decode(&self, conn: &mut ConnState, reader: &mut Reader) -> io::Result<Option<Op>>;

    /// Apply an op to the engine and return the bytes to send back.
    fn execute(&self, conn: &mut ConnState, op: &Op) -> Vec<u8>;

    /// Protocol-specific fault action names this emulator understands (beyond the
    /// generic `kill_connection` / `inject_error` / `delay` the kit handles).
    fn fault_actions(&self) -> &'static [&'static str] {
        &[]
    }

    /// Run a protocol-specific fault action, returning the bytes to send instead of
    /// the normal reply. Only ever called with an `action` from [`Self::fault_actions`].
    fn apply_fault(&self, action: &str, params: &Value, conn: &mut ConnState, op: &Op) -> Vec<u8>;

    /// Encode a protocol-appropriate error frame for the generic `inject_error` action.
    fn encode_error(&self, params: &Value) -> Vec<u8>;

    /// Whether an op belongs to a protocol-registered op *class* (e.g. the cache
    /// registers `read` = `GET|MGET`). Lets a rule trigger on a class, not just an
    /// exact op type. Default: no classes.
    fn op_class_matches(&self, op: &Op, class: &str) -> bool {
        let _ = (op, class);
        false
    }

    /// Extra trigger scoping for key-targeted faults (e.g. `expire_key` narrowing to
    /// one key via `params`). Default: no extra narrowing.
    fn matches(&self, op: &Op, params: &Value) -> bool {
        let _ = (op, params);
        true
    }

    /// Load initial state from a lesson fixture (the body of `POST /seed`).
    fn seed(&self, body: &Value) -> Result<(), String>;

    /// Capture engine state as the reset baseline.
    fn snapshot(&self) -> Value;

    /// Restore engine state from a snapshot.
    fn restore(&self, snap: &Value);

    /// Dump engine state for `GET /state` assertions.
    fn state(&self) -> Value;
}
