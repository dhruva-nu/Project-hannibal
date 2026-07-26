//! `cannae-cache` — the Redis (RESP2) emulator (Phase 1, issue #134).
//!
//! Real Redis clients connect to it unmodified: it speaks RESP2 on `:6379` and
//! implements the command subset caching lessons need. What it is *not* is a cache —
//! it is a lesson prop with a Redis-shaped mouth, and everything that makes it useful
//! is the part real Redis cannot do:
//!
//! - **Deterministic time.** Expiry runs off a logical clock the harness advances
//!   (`advance_clock`), so "the entry expired" is a scripted event, not a sleep.
//! - **Scripted faults.** `expire_key` and `serve_stale` produce the stale-cache
//!   situations that are impossible to reproduce reliably against real infrastructure.
//!
//! It adds only `decode` / `execute` / `apply_fault` / `encode_error` / `matches` plus
//! its registered actions — how a fault travels from the control plane to the
//! student's socket is the kit's, unchanged since Phase 0.

mod commands;
mod engine;
mod resp;

use async_trait::async_trait;
use cannae_core::{ConnState, Emulator, Op, Reader, CONNECT_OP, DISCONNECT_OP};
use commands::{keys_of, OP_NAMES, READ_OPS, WRITE_OPS};
use engine::Engine;
use resp::Reply;
use serde_json::Value;
use std::sync::{Mutex, MutexGuard};

/// The port real Redis listens on. Students connect to `redis://cache:6379` and never
/// learn otherwise.
pub const DEFAULT_PORT: u16 = 6379;

const READ_CLASS: &str = "read";
const WRITE_CLASS: &str = "write";

/// Serve a key's *previous* value once, without touching what is actually stored —
/// the stale-read a cache-invalidation lesson is built around.
const SERVE_STALE: &str = "serve_stale";
/// Drop a key on the op that triggers it, so the very next read is a miss.
const EXPIRE_KEY: &str = "expire_key";
/// Move the logical clock forward. Immediate: it applies at install time, no trigger.
const ADVANCE_CLOCK: &str = "advance_clock";

/// Actions that act on a named key, so a rule arming one must be able to name it.
const KEY_TARGETING: [&str; 2] = [EXPIRE_KEY, SERVE_STALE];

pub struct CacheEmulator {
    port: u16,
    engine: Mutex<Engine>,
}

impl CacheEmulator {
    pub fn new() -> Self {
        Self::with_port(DEFAULT_PORT)
    }

    pub fn with_port(port: u16) -> Self {
        Self {
            port,
            engine: Mutex::new(Engine::default()),
        }
    }

    fn engine(&self) -> MutexGuard<'_, Engine> {
        self.engine.lock().unwrap()
    }
}

impl Default for CacheEmulator {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Emulator for CacheEmulator {
    fn name(&self) -> &str {
        "cache"
    }

    fn port(&self) -> u16 {
        self.port
    }

    async fn decode(
        &self,
        _conn: &mut ConnState,
        reader: &mut Reader,
    ) -> std::io::Result<Option<Op>> {
        Ok(resp::read_command(reader)
            .await?
            .map(|argv| commands::parse(&argv)))
    }

    fn op_names(&self) -> &'static [&'static str] {
        OP_NAMES
    }

    fn op_classes(&self) -> &'static [&'static str] {
        &[READ_CLASS, WRITE_CLASS]
    }

    fn execute(&self, _conn: &mut ConnState, op: &Op) -> Vec<u8> {
        if op.op == CONNECT_OP || op.op == DISCONNECT_OP {
            return Vec::new();
        }
        commands::execute(&mut self.engine(), op).encode()
    }

    fn fault_actions(&self) -> &'static [&'static str] {
        &[EXPIRE_KEY, SERVE_STALE]
    }

    fn immediate_actions(&self) -> &'static [&'static str] {
        &[ADVANCE_CLOCK]
    }

    fn validate_fault(&self, action: &str, params: &Value) -> Result<(), String> {
        if let Some(key) = params.get("key") {
            key.as_str()
                .ok_or("params.key must be a string".to_string())?;
        }
        match action {
            // Without a value there is nothing stale to serve, so the rule would fire
            // into nothing — rejected here rather than at 3am inside a lesson.
            SERVE_STALE => match params.get("value") {
                None => Err(format!("{SERVE_STALE} requires params.value")),
                Some(Value::String(_) | Value::Number(_)) => Ok(()),
                Some(_) => Err("params.value must be a string or number".into()),
            },
            ADVANCE_CLOCK => advance_ms(params).map(drop),
            _ => Ok(()),
        }
    }

    fn validate_trigger(
        &self,
        action: &str,
        op_matches: &str,
        params: &Value,
    ) -> Result<(), String> {
        // Serving a stale value means running the op against a value the keyspace does
        // not hold, then putting the real entry back. On a write that "putting back"
        // reverts what the student just wrote — while the client is told `+OK`.
        if action == SERVE_STALE && !is_read_trigger(op_matches) {
            return Err(format!(
                "{SERVE_STALE} only arms on a read ({} or {}); on {op_matches} it would \
                 discard the write it fired on",
                READ_CLASS,
                READ_OPS.join("/")
            ));
        }
        // A key-targeting fault must know which key when it fires: either the rule names
        // one or the triggering op carries one. Neither means a rule that can only ever
        // reply with an error.
        if KEY_TARGETING.contains(&action)
            && params.get("key").is_none()
            && !carries_a_key(op_matches)
        {
            return Err(format!(
                "{action} on {op_matches} needs params.key: that trigger names no key"
            ));
        }
        Ok(())
    }

    fn apply_immediate(&self, action: &str, params: &Value) -> Result<(), String> {
        match action {
            ADVANCE_CLOCK => {
                self.engine().advance_ms(advance_ms(params)?);
                Ok(())
            }
            other => Err(format!("{other} is not an immediate action")),
        }
    }

    fn apply_fault(&self, action: &str, params: &Value, _conn: &mut ConnState, op: &Op) -> Vec<u8> {
        let targets = target_keys(params, op);
        if targets.is_empty() {
            return Reply::Error(format!("ERR fault {action} has no target key")).encode();
        }
        let mut engine = self.engine();
        match action {
            // Drop the key, *then* run the op normally: a GET that trips this rule
            // returns the same miss it would after a real expiry.
            EXPIRE_KEY => {
                for key in &targets {
                    engine.remove(key);
                }
                commands::execute(&mut engine, op).encode()
            }
            // Slot the stale value in, run the op, put the real entry back. The op sees
            // the old value; the keyspace is untouched, so it is served exactly once.
            SERVE_STALE => {
                // `validate_trigger` refuses to arm this on a write, so reaching here
                // with one means the two have drifted. Say so rather than restore over
                // the write and report `+OK` for a write that did not happen.
                if !READ_OPS.contains(&op.op.as_str()) {
                    return Reply::Error(format!(
                        "ERR fault {SERVE_STALE} only applies to a read, not {}",
                        op.op
                    ))
                    .encode();
                }
                let stale = stale_value(params);
                let mut saved = Vec::with_capacity(targets.len());
                for key in &targets {
                    saved.push((key.clone(), engine.take(key)));
                    engine.set(key, stale.clone(), None);
                }
                let reply = commands::execute(&mut engine, op).encode();
                for (key, entry) in saved {
                    match entry {
                        Some(entry) => engine.put(&key, entry),
                        None => {
                            engine.remove(&key);
                        }
                    }
                }
                reply
            }
            other => Reply::Error(format!("ERR unknown fault {other}")).encode(),
        }
    }

    fn encode_error(&self, params: &Value) -> Vec<u8> {
        let message = params
            .get("resp_error")
            .and_then(Value::as_str)
            .unwrap_or("ERR injected");
        Reply::Error(message.to_string()).encode()
    }

    fn op_class_matches(&self, op: &Op, class: &str) -> bool {
        match class {
            READ_CLASS => READ_OPS.contains(&op.op.as_str()),
            WRITE_CLASS => WRITE_OPS.contains(&op.op.as_str()),
            _ => false,
        }
    }

    fn matches(&self, op: &Op, params: &Value) -> bool {
        match params.get("key").and_then(Value::as_str) {
            None => true,
            Some(key) => keys_of(op).iter().any(|touched| touched == key),
        }
    }

    fn seed(&self, body: &Value) -> Result<(), String> {
        self.engine().load(body)
    }

    fn snapshot(&self) -> Value {
        self.engine().snapshot()
    }

    fn restore(&self, snap: &Value) {
        // The only caller is `/reset`, replaying a snapshot this emulator produced. A
        // failure here means the two shapes have drifted, which would silently grade
        // against the wrong keyspace — so it is a hard stop, not a warning.
        //
        // Abort rather than panic: a panic here unwinds through a control-plane handler
        // holding the engine lock, which poisons it. Every later `engine()` would then
        // panic too, so student connections would die with no reply and the op log would
        // stop growing while the process kept looking healthy — a silent stop, which is
        // the failure this guard exists to prevent. (The release profile is
        // `panic = "abort"`, so this only diverges in debug builds; say it out loud
        // anyway rather than depend on a profile setting.)
        if let Err(error) = self.engine().load(snap) {
            eprintln!("cannae cache: a snapshot failed to reload ({error}); aborting");
            std::process::abort();
        }
    }

    fn state(&self) -> Value {
        self.engine().state()
    }
}

/// Which keys a fault acts on: the rule's `params.key` if it named one, otherwise
/// every key the triggering op touched.
fn target_keys(params: &Value, op: &Op) -> Vec<String> {
    match params.get("key").and_then(Value::as_str) {
        Some(key) => vec![key.to_string()],
        None => keys_of(op),
    }
}

/// Whether a trigger names reads only — either the class or one of the read commands.
fn is_read_trigger(op_matches: &str) -> bool {
    op_matches == READ_CLASS || READ_OPS.contains(&op_matches)
}

/// Whether every op a trigger can match carries a key. `connect` and the handshake
/// commands (`PING`, `INFO`, …) do not, so a key-targeting rule on one needs to say
/// which key it means.
fn carries_a_key(op_matches: &str) -> bool {
    is_read_trigger(op_matches) || op_matches == WRITE_CLASS || WRITE_OPS.contains(&op_matches)
}

fn stale_value(params: &Value) -> Vec<u8> {
    match &params["value"] {
        Value::String(text) => text.clone().into_bytes(),
        other => other.to_string().into_bytes(),
    }
}

/// `advance_clock` takes exactly one of `seconds` or `ms`. Accepting both would leave
/// "which one won?" undecidable from the rule alone.
fn advance_ms(params: &Value) -> Result<u64, String> {
    let read = |field: &str| -> Result<Option<u64>, String> {
        match params.get(field) {
            None => Ok(None),
            Some(value) => value
                .as_u64()
                .map(Some)
                .ok_or(format!("{ADVANCE_CLOCK}: {field} must be a whole number")),
        }
    };
    match (read("seconds")?, read("ms")?) {
        (Some(_), Some(_)) => Err(format!("{ADVANCE_CLOCK}: pass seconds or ms, not both")),
        (Some(seconds), None) => Ok(seconds.saturating_mul(1000)),
        (None, Some(ms)) => Ok(ms),
        (None, None) => Err(format!("{ADVANCE_CLOCK} requires seconds or ms")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn conn() -> ConnState {
        ConnState { conn_id: 1, seq: 0 }
    }

    fn op(command: &str) -> Op {
        let argv: Vec<Vec<u8>> = command
            .split(' ')
            .map(|word| word.as_bytes().to_vec())
            .collect();
        commands::parse(&argv)
    }

    fn run(emu: &CacheEmulator, command: &str) -> String {
        String::from_utf8(emu.execute(&mut conn(), &op(command))).unwrap()
    }

    fn seeded() -> CacheEmulator {
        let emu = CacheEmulator::new();
        emu.seed(&json!({ "emulator": "cache", "keys": { "user:1": "ada" } }))
            .unwrap();
        emu
    }

    #[test]
    fn lifecycle_ops_produce_no_bytes() {
        let emu = CacheEmulator::new();
        for lifecycle in [CONNECT_OP, DISCONNECT_OP] {
            assert!(emu
                .execute(&mut conn(), &Op::lifecycle(lifecycle))
                .is_empty());
        }
    }

    #[test]
    fn expire_key_turns_the_triggering_read_into_a_miss() {
        let emu = seeded();
        let reply = emu.apply_fault(EXPIRE_KEY, &json!({}), &mut conn(), &op("GET user:1"));
        assert_eq!(String::from_utf8(reply).unwrap(), "$-1\r\n");
        // Really gone, not just hidden for one read.
        assert_eq!(run(&emu, "GET user:1"), "$-1\r\n");
    }

    #[test]
    fn expire_key_can_target_a_key_the_op_did_not_touch() {
        let emu = seeded();
        emu.apply_fault(
            EXPIRE_KEY,
            &json!({ "key": "user:1" }),
            &mut conn(),
            &op("GET other"),
        );
        assert_eq!(run(&emu, "GET user:1"), "$-1\r\n");
    }

    #[test]
    fn serve_stale_shows_the_old_value_exactly_once() {
        let emu = seeded();
        let params = json!({ "value": "grace" });
        let reply = emu.apply_fault(SERVE_STALE, &params, &mut conn(), &op("GET user:1"));
        assert_eq!(String::from_utf8(reply).unwrap(), "$5\r\ngrace\r\n");
        // The keyspace is untouched: the next read sees the real, current value.
        assert_eq!(run(&emu, "GET user:1"), "$3\r\nada\r\n");
    }

    #[test]
    fn serve_stale_leaves_a_missing_key_missing() {
        let emu = CacheEmulator::new();
        let params = json!({ "value": "ghost" });
        let reply = emu.apply_fault(SERVE_STALE, &params, &mut conn(), &op("GET gone"));
        assert_eq!(String::from_utf8(reply).unwrap(), "$5\r\nghost\r\n");
        assert_eq!(run(&emu, "GET gone"), "$-1\r\n");
        assert_eq!(emu.state()["keys"], json!({}));
    }

    #[test]
    fn serve_stale_preserves_the_real_entrys_ttl() {
        let emu = CacheEmulator::new();
        emu.seed(&json!({ "keys": { "k": { "value": "fresh", "ttl_ms": 5_000 } } }))
            .unwrap();
        emu.apply_fault(
            SERVE_STALE,
            &json!({ "value": "old" }),
            &mut conn(),
            &op("GET k"),
        );
        assert_eq!(
            emu.state()["keys"]["k"],
            json!({ "value": "fresh", "ttl_ms": 5_000 })
        );
    }

    #[test]
    fn a_fault_with_no_target_key_says_so_instead_of_silently_passing() {
        let emu = CacheEmulator::new();
        let reply = emu.apply_fault(EXPIRE_KEY, &json!({}), &mut conn(), &op("PING"));
        assert_eq!(
            String::from_utf8(reply).unwrap(),
            "-ERR fault expire_key has no target key\r\n"
        );
    }

    #[test]
    fn advance_clock_expires_keys_without_a_sleep() {
        let emu = CacheEmulator::new();
        emu.seed(&json!({ "keys": { "user:1": { "value": "ada", "ttl_seconds": 60 } } }))
            .unwrap();
        emu.apply_immediate(ADVANCE_CLOCK, &json!({ "seconds": 59 }))
            .unwrap();
        assert_eq!(run(&emu, "GET user:1"), "$3\r\nada\r\n");
        emu.apply_immediate(ADVANCE_CLOCK, &json!({ "ms": 1_000 }))
            .unwrap();
        assert_eq!(run(&emu, "GET user:1"), "$-1\r\n");
    }

    #[test]
    fn fault_params_are_validated_before_a_rule_is_armed() {
        let emu = CacheEmulator::new();
        let rejected = [
            (SERVE_STALE, json!({})),
            (SERVE_STALE, json!({ "value": ["a"] })),
            (EXPIRE_KEY, json!({ "key": 7 })),
            (ADVANCE_CLOCK, json!({})),
            (ADVANCE_CLOCK, json!({ "seconds": 1, "ms": 1 })),
            (ADVANCE_CLOCK, json!({ "seconds": "a while" })),
            (ADVANCE_CLOCK, json!({ "seconds": -1 })),
        ];
        for (action, params) in rejected {
            assert!(
                emu.validate_fault(action, &params).is_err(),
                "{action} {params} must be rejected"
            );
        }
        assert!(emu
            .validate_fault(SERVE_STALE, &json!({ "value": "v" }))
            .is_ok());
        assert!(emu
            .validate_fault(EXPIRE_KEY, &json!({ "key": "k" }))
            .is_ok());
        assert!(emu
            .validate_fault(ADVANCE_CLOCK, &json!({ "seconds": 61 }))
            .is_ok());
        // A generic action still gets its key narrowing checked.
        assert!(emu
            .validate_fault("kill_connection", &json!({ "key": 7 }))
            .is_err());
    }

    /// The failure this guards against is silent: the client is told `+OK`, the op log
    /// shows the SET, and the value is the one from before the write.
    #[test]
    fn serve_stale_never_arms_on_a_write() {
        let emu = CacheEmulator::new();
        let stale = json!({ "value": "old" });
        for write in [WRITE_CLASS, "SET", "INCR", "DEL"] {
            assert!(
                emu.validate_trigger(SERVE_STALE, write, &stale).is_err(),
                "{write} must not arm serve_stale"
            );
        }
        for read in [READ_CLASS, "GET", "MGET"] {
            assert!(
                emu.validate_trigger(SERVE_STALE, read, &stale).is_ok(),
                "{read} must arm serve_stale"
            );
        }
        // Nor on an op that reads nothing at all.
        assert!(emu.validate_trigger(SERVE_STALE, "PING", &stale).is_err());
        assert!(emu
            .validate_trigger(SERVE_STALE, CONNECT_OP, &stale)
            .is_err());
    }

    #[test]
    fn a_write_that_reaches_serve_stale_is_refused_rather_than_reverted() {
        let emu = seeded();
        let reply = emu.apply_fault(
            SERVE_STALE,
            &json!({ "value": "old" }),
            &mut conn(),
            &op("SET user:1 grace"),
        );
        assert_eq!(
            String::from_utf8(reply).unwrap(),
            "-ERR fault serve_stale only applies to a read, not SET\r\n"
        );
        assert_eq!(
            run(&emu, "GET user:1"),
            "$3\r\nada\r\n",
            "and nothing wrote"
        );
    }

    #[test]
    fn a_key_targeting_rule_must_be_able_to_name_its_key() {
        let emu = CacheEmulator::new();
        // A keyless trigger gives `keys_of` nothing, so the rule could only error.
        assert!(emu
            .validate_trigger(EXPIRE_KEY, "PING", &json!({}))
            .is_err());
        assert!(emu
            .validate_trigger(EXPIRE_KEY, CONNECT_OP, &json!({}))
            .is_err());
        // Either half is enough: the rule names the key, or the trigger carries one.
        assert!(emu
            .validate_trigger(EXPIRE_KEY, "PING", &json!({ "key": "user:1" }))
            .is_ok());
        assert!(emu.validate_trigger(EXPIRE_KEY, "GET", &json!({})).is_ok());
        assert!(emu
            .validate_trigger(EXPIRE_KEY, WRITE_CLASS, &json!({}))
            .is_ok());
        // A generic action targets no key, so no pairing is off limits.
        assert!(emu
            .validate_trigger("kill_connection", CONNECT_OP, &json!({}))
            .is_ok());
    }

    #[test]
    fn op_classes_group_reads_and_writes() {
        let emu = CacheEmulator::new();
        assert!(emu.op_class_matches(&op("GET k"), READ_CLASS));
        assert!(emu.op_class_matches(&op("MGET a b"), READ_CLASS));
        assert!(!emu.op_class_matches(&op("SET k v"), READ_CLASS));
        assert!(emu.op_class_matches(&op("SET k v"), WRITE_CLASS));
        assert!(emu.op_class_matches(&op("DEL k"), WRITE_CLASS));
        assert!(!emu.op_class_matches(&op("PING"), "anything"));
    }

    #[test]
    fn key_scoping_narrows_to_one_key_across_both_arg_shapes() {
        let emu = CacheEmulator::new();
        let scope = json!({ "key": "user:1" });
        assert!(emu.matches(&op("GET user:1"), &scope));
        assert!(!emu.matches(&op("GET user:2"), &scope));
        assert!(emu.matches(&op("MGET user:2 user:1"), &scope));
        assert!(!emu.matches(&op("PING"), &scope));
        // An unscoped rule matches every op.
        assert!(emu.matches(&op("PING"), &json!({})));
    }

    #[test]
    fn inject_error_encodes_a_real_resp_error_frame() {
        let emu = CacheEmulator::new();
        assert_eq!(
            emu.encode_error(&json!({ "resp_error": "READONLY nope" })),
            b"-READONLY nope\r\n"
        );
        assert_eq!(emu.encode_error(&json!({})), b"-ERR injected\r\n");
    }

    #[test]
    fn reset_restores_the_seeded_keyspace_and_the_clock() {
        let emu = CacheEmulator::new();
        emu.seed(&json!({ "keys": { "user:1": "ada" } })).unwrap();
        let baseline = emu.snapshot();

        run(&emu, "SET user:1 grace");
        run(&emu, "SET scratch x");
        emu.apply_immediate(ADVANCE_CLOCK, &json!({ "seconds": 90 }))
            .unwrap();
        emu.restore(&baseline);

        assert_eq!(
            emu.state(),
            json!({ "clock_ms": 0, "keys": { "user:1": { "value": "ada", "ttl_ms": null } } })
        );
    }

    #[test]
    fn seed_rejects_a_malformed_fixture() {
        let emu = CacheEmulator::new();
        assert!(emu
            .seed(&json!({ "emulator": "cache", "kys": {} }))
            .is_err());
    }

    #[test]
    fn the_default_port_is_the_one_students_type() {
        assert_eq!(CacheEmulator::default().port(), 6379);
        assert_eq!(CacheEmulator::with_port(7000).port(), 7000);
        assert_eq!(CacheEmulator::new().name(), "cache");
    }
}
