//! `emu-echo` — the trivial proving emulator (Phase 0, issue #132).
//!
//! It does nothing but echo lines back, prefixed by a seeded string. Its only job
//! is to exercise the whole kit — connection front, op log, fault engine, control
//! plane — with the smallest possible protocol, and to prove the kit is extensible
//! from *outside* `emu-core`, exactly how Redis/Postgres/Mongo/AMQP will plug in.

use async_trait::async_trait;
use cannae_core::{ConnState, Emulator, Op, Reader};
use serde_json::{json, Value};
use std::sync::Mutex;
use tokio::io::AsyncBufReadExt;

/// The port the binary starts echo on by default. Not a standard service port —
/// echo is a demo, not a real protocol.
pub const DEFAULT_PORT: u16 = 7777;

#[derive(Default)]
struct Engine {
    prefix: String,
    count: u64,
}

/// A line-framed echo server built on [`Emulator`].
pub struct EchoEmulator {
    port: u16,
    engine: Mutex<Engine>,
}

impl EchoEmulator {
    pub fn new() -> Self {
        Self::with_port(DEFAULT_PORT)
    }

    pub fn with_port(port: u16) -> Self {
        Self {
            port,
            engine: Mutex::new(Engine::default()),
        }
    }
}

impl Default for EchoEmulator {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Emulator for EchoEmulator {
    fn name(&self) -> &str {
        "echo"
    }

    fn port(&self) -> u16 {
        self.port
    }

    async fn decode(
        &self,
        _conn: &mut ConnState,
        reader: &mut Reader,
    ) -> std::io::Result<Option<Op>> {
        let mut line = String::new();
        if reader.read_line(&mut line).await? == 0 {
            return Ok(None);
        }
        let text = line.trim_end_matches(['\r', '\n']).to_string();
        Ok(Some(Op {
            op: "ECHO".into(),
            args: json!({ "line": text }),
        }))
    }

    fn execute(&self, _conn: &mut ConnState, op: &Op) -> Vec<u8> {
        // Lifecycle ops (`connect` / `disconnect`) get no reply.
        if op.op != "ECHO" {
            return Vec::new();
        }
        let line = op.args.get("line").and_then(Value::as_str).unwrap_or("");
        let mut engine = self.engine.lock().unwrap();
        engine.count += 1;
        format!("{}{}\n", engine.prefix, line).into_bytes()
    }

    fn fault_actions(&self) -> &'static [&'static str] {
        &["corrupt"]
    }

    fn apply_fault(
        &self,
        action: &str,
        _params: &Value,
        _conn: &mut ConnState,
        _op: &Op,
    ) -> Vec<u8> {
        match action {
            "corrupt" => b"CORRUPTED\n".to_vec(),
            _ => Vec::new(),
        }
    }

    fn encode_error(&self, params: &Value) -> Vec<u8> {
        let message = params
            .get("resp_error")
            .and_then(Value::as_str)
            .unwrap_or("ERR injected");
        format!("-{message}\n").into_bytes()
    }

    fn seed(&self, body: &Value) -> Result<(), String> {
        if let Some(prefix) = body.get("prefix") {
            let prefix = prefix.as_str().ok_or("prefix must be a string")?;
            self.engine.lock().unwrap().prefix = prefix.to_string();
        }
        Ok(())
    }

    fn snapshot(&self) -> Value {
        let engine = self.engine.lock().unwrap();
        json!({ "prefix": engine.prefix, "count": engine.count })
    }

    fn restore(&self, snap: &Value) {
        let mut engine = self.engine.lock().unwrap();
        engine.prefix = snap
            .get("prefix")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        engine.count = snap.get("count").and_then(Value::as_u64).unwrap_or(0);
    }

    fn state(&self) -> Value {
        let engine = self.engine.lock().unwrap();
        json!({ "echo_count": engine.count, "prefix": engine.prefix })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn() -> ConnState {
        ConnState { conn_id: 1, seq: 0 }
    }

    fn echo(line: &str) -> Op {
        Op {
            op: "ECHO".into(),
            args: json!({ "line": line }),
        }
    }

    #[test]
    fn execute_prefixes_and_counts() {
        let emu = EchoEmulator::new();
        emu.seed(&json!({ "prefix": ">>" })).unwrap();
        assert_eq!(emu.execute(&mut conn(), &echo("hi")), b">>hi\n");
        assert_eq!(emu.execute(&mut conn(), &echo("yo")), b">>yo\n");
        assert_eq!(emu.state()["echo_count"], 2);
    }

    #[test]
    fn lifecycle_ops_do_not_reply() {
        let emu = EchoEmulator::new();
        assert!(emu
            .execute(&mut conn(), &Op::lifecycle("connect"))
            .is_empty());
    }

    #[test]
    fn seed_rejects_non_string_prefix() {
        let emu = EchoEmulator::new();
        assert!(emu.seed(&json!({ "prefix": 7 })).is_err());
        // A body without a prefix is a no-op, not an error.
        assert!(emu.seed(&json!({ "emulator": "echo" })).is_ok());
    }

    #[test]
    fn snapshot_and_restore_round_trip() {
        let emu = EchoEmulator::new();
        emu.seed(&json!({ "prefix": "A" })).unwrap();
        emu.execute(&mut conn(), &echo("x"));
        let snap = emu.snapshot();

        emu.seed(&json!({ "prefix": "B" })).unwrap();
        emu.execute(&mut conn(), &echo("y"));
        emu.restore(&snap);

        assert_eq!(emu.state(), json!({ "echo_count": 1, "prefix": "A" }));
    }

    #[test]
    fn fault_actions_are_registered_and_applied() {
        let emu = EchoEmulator::new();
        assert_eq!(emu.fault_actions(), &["corrupt"]);
        assert_eq!(
            emu.apply_fault("corrupt", &Value::Null, &mut conn(), &echo("x")),
            b"CORRUPTED\n"
        );
    }

    #[test]
    fn encode_error_uses_resp_error_or_a_default() {
        let emu = EchoEmulator::new();
        assert_eq!(
            emu.encode_error(&json!({ "resp_error": "boom" })),
            b"-boom\n"
        );
        assert_eq!(emu.encode_error(&Value::Null), b"-ERR injected\n");
    }

    #[test]
    fn defaults_match_the_no_op_hooks() {
        let emu = EchoEmulator::default();
        assert_eq!(emu.port(), DEFAULT_PORT);
        assert!(!emu.op_class_matches(&echo("x"), "read"));
        assert!(emu.matches(&echo("x"), &Value::Null));
    }
}
