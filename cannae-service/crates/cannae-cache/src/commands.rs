//! The command surface: `argv` → a semantic [`Op`], and an [`Op`] → a [`Reply`].
//!
//! The subset here is the one caching lessons need (`plans/infra-emulators.md` §3),
//! grown lesson-by-lesson rather than toward completeness — plus the handshake
//! commands the blessed clients issue before they will talk at all (`HELLO`,
//! `CLIENT`, `INFO`).
//!
//! Parsing is **total**: a malformed command still decodes to an op, carrying the
//! error the client must receive. That keeps the pipeline's ordering guarantee
//! (`decode → oplog.append → …`) intact, so a student's typo shows up in the log a
//! grader reads instead of vanishing.

use crate::engine::{value_from_json, value_to_json, Engine};
use cannae_core::Op;
use serde_json::{json, Map, Value};

use crate::resp::Reply;

/// Every op [`parse`] produces for a *recognised* command. Unknown commands log under
/// their own name but are deliberately absent here, so `POST /faults` rejects a
/// trigger naming one — a rule on a command the cache does not implement could only
/// ever fire on the error path.
pub const OP_NAMES: &[&str] = &[
    "GET", "MGET", "SET", "SETNX", "SETEX", "DEL", "EXISTS", "EXPIRE", "TTL", "INCR", "INCRBY",
    "PING", "SELECT", "HELLO", "CLIENT", "COMMAND", "INFO", "QUIT",
];

/// Op classes a fault rule may trigger on, so a lesson can say "on the first read"
/// without naming every command that reads.
pub const READ_OPS: &[&str] = &["GET", "MGET"];
pub const WRITE_OPS: &[&str] = &["SET", "SETNX", "SETEX", "DEL", "INCR", "INCRBY", "EXPIRE"];

/// What `INFO` reports. `loading:0` is not decoration: ioredis blocks its ready-check
/// until it sees it, so a client cannot issue a single command without this.
const INFO_BODY: &str = "# Server\r\nredis_version:7.0.0\r\nredis_mode:standalone\r\n\
     os:cannae\r\narch_bits:64\r\nprocess_id:1\r\n\
     # Clients\r\nconnected_clients:1\r\n\
     # Replication\r\nrole:master\r\nconnected_slaves:0\r\n\
     # Persistence\r\nloading:0\r\nrdb_bgsave_in_progress:0\r\n";

/// One namespace, one database. `SELECT 1` is rejected rather than silently aliased
/// to db 0 — a lesson that believed it had two keyspaces would grade nonsense.
const ONLY_DB: i64 = 0;

/// Refusing RESP3 is the signal both blessed clients use to fall back to RESP2. Sent
/// from two places — `parse` for an unreadable version, `execute` for a readable one
/// that is not 2 — and the clients key their fallback on the exact prefix.
const NOPROTO: &str = "NOPROTO unsupported protocol version";

pub fn parse(argv: &[Vec<u8>]) -> Op {
    let name = text(&argv[0]).to_uppercase();
    let rest = &argv[1..];
    let args = match name.as_str() {
        "GET" | "TTL" | "INCR" => fixed(&name, rest, &["key"]),
        "SETNX" => fixed(&name, rest, &["key", "value"]),
        "QUIT" => fixed(&name, rest, &[]),
        "DEL" | "EXISTS" | "MGET" => key_list(&name, rest),
        "SET" => parse_set(rest),
        "SETEX" => parse_setex(rest),
        "EXPIRE" => parse_expire(rest),
        "INCRBY" => parse_incrby(rest),
        "SELECT" => parse_select(rest),
        "HELLO" => parse_hello(rest),
        "PING" => optional_text(&name, rest, "message"),
        "INFO" => optional_text(&name, rest, "section"),
        "CLIENT" => parse_subcommand(&name, rest, true),
        "COMMAND" => parse_subcommand(&name, rest, false),
        _ => json!({ "error": format!("ERR unknown command '{name}'") }),
    };
    Op { op: name, args }
}

pub fn execute(engine: &mut Engine, op: &Op) -> Reply {
    if let Some(message) = op.args.get("error").and_then(Value::as_str) {
        return Reply::Error(message.to_string());
    }
    match op.op.as_str() {
        "GET" => bytes_or_nil(engine.get(key_of(op))),
        "MGET" => Reply::Array(
            keys_of(op)
                .into_iter()
                .map(|key| bytes_or_nil(engine.get(&key)))
                .collect(),
        ),
        "SET" => set(engine, op),
        "SETNX" => match engine.exists(key_of(op)) {
            true => Reply::Int(0),
            false => {
                engine.set(key_of(op), value_of(op), None);
                Reply::Int(1)
            }
        },
        "SETEX" => match number(op, "ttl_ms") {
            ttl_ms if ttl_ms <= 0 => invalid_expire("setex"),
            ttl_ms => {
                engine.set(key_of(op), value_of(op), Some(ttl_ms as u64));
                Reply::ok()
            }
        },
        "DEL" => Reply::Int(count(keys_of(op), |key| engine.remove(key))),
        "EXISTS" => Reply::Int(count(keys_of(op), |key| engine.exists(key))),
        "EXPIRE" => match number(op, "ttl_ms") {
            ttl_ms if ttl_ms <= 0 => Reply::Int(engine.remove(key_of(op)) as i64),
            ttl_ms => Reply::Int(engine.expire(key_of(op), ttl_ms as u64) as i64),
        },
        "TTL" => Reply::Int(match engine.ttl_ms(key_of(op)) {
            None => -2,
            Some(None) => -1,
            // Rounded up, so a key with any life left never reports 0 seconds.
            Some(Some(ms)) => ms.div_ceil(1000) as i64,
        }),
        "INCR" => incr_by(engine, op, 1),
        "INCRBY" => incr_by(engine, op, number(op, "delta")),
        "PING" => match op.args.get("message").and_then(Value::as_str) {
            None => Reply::Simple("PONG".into()),
            Some(message) => Reply::bulk(message),
        },
        "SELECT" => match number(op, "index") {
            ONLY_DB => Reply::ok(),
            _ => Reply::Error("ERR DB index is out of range".into()),
        },
        "HELLO" => hello(op),
        "CLIENT" => client(op),
        "COMMAND" => Reply::Array(Vec::new()),
        "INFO" => Reply::Bulk(INFO_BODY.as_bytes().to_vec()),
        "QUIT" => Reply::ok(),
        // Unreachable for anything `parse` produced: every recognised command has an
        // arm above and every unrecognised one carries an `error`. Lifecycle ops never
        // get here — the emulator answers those with no bytes at all.
        other => Reply::Error(format!("ERR unknown command '{other}'")),
    }
}

fn set(engine: &mut Engine, op: &Op) -> Reply {
    let key = key_of(op);
    let exists = engine.exists(key);
    let blocked = match op.args.get("exists_mode").and_then(Value::as_str) {
        Some("NX") => exists,
        Some("XX") => !exists,
        _ => false,
    };
    if blocked {
        return Reply::Nil;
    }
    match op.args.get("keep_ttl") == Some(&Value::Bool(true)) {
        true => engine.set_keep_ttl(key, value_of(op)),
        false => engine.set(key, value_of(op), op.args["ttl_ms"].as_u64()),
    }
    Reply::ok()
}

fn incr_by(engine: &mut Engine, op: &Op, delta: i64) -> Reply {
    match engine.incr_by(key_of(op), delta) {
        Ok(value) => Reply::Int(value),
        Err(message) => Reply::Error(message),
    }
}

fn hello(op: &Op) -> Reply {
    // RESP3 is refused rather than half-implemented, which is exactly the signal
    // every blessed client uses to fall back to RESP2.
    if !matches!(op.args["protocol"].as_i64(), None | Some(2)) {
        return Reply::Error(NOPROTO.into());
    }
    Reply::Array(vec![
        Reply::bulk("server"),
        Reply::bulk("redis"),
        Reply::bulk("version"),
        Reply::bulk("7.0.0"),
        Reply::bulk("proto"),
        Reply::Int(2),
        Reply::bulk("id"),
        Reply::Int(1),
        Reply::bulk("mode"),
        Reply::bulk("standalone"),
        Reply::bulk("role"),
        Reply::bulk("master"),
        Reply::bulk("modules"),
        Reply::Array(Vec::new()),
    ])
}

/// Connection bookkeeping every modern client sends unprompted (`CLIENT SETINFO`
/// carries the library name). Accepted and ignored — none of it is lesson state.
fn client(op: &Op) -> Reply {
    match op.args["subcommand"].as_str().unwrap_or_default() {
        "SETNAME" | "SETINFO" | "NO-EVICT" | "NO-TOUCH" | "REPLY" => Reply::ok(),
        "GETNAME" => Reply::Nil,
        "ID" => Reply::Int(1),
        other => Reply::Error(format!("ERR unknown subcommand '{other}'")),
    }
}

fn count(keys: Vec<String>, mut hit: impl FnMut(&str) -> bool) -> i64 {
    keys.iter().filter(|key| hit(key)).count() as i64
}

fn bytes_or_nil(value: Option<Vec<u8>>) -> Reply {
    value.map_or(Reply::Nil, Reply::Bulk)
}

// ---------------------------------------------------------------------------
// Reading the semantic args back out. `parse` guarantees these fields exist and
// have these types for the op it produced, so the defaults here are unreachable.
// ---------------------------------------------------------------------------

fn key_of(op: &Op) -> &str {
    op.args.get("key").and_then(Value::as_str).unwrap_or("")
}

/// Every key an op touches, whatever shape it stores them in — what key-scoped fault
/// rules narrow against and what the `expire_key` fault targets.
pub fn keys_of(op: &Op) -> Vec<String> {
    if let Some(key) = op.args.get("key").and_then(Value::as_str) {
        return vec![key.to_string()];
    }
    op.args
        .get("keys")
        .and_then(Value::as_array)
        .map(|keys| {
            keys.iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn value_of(op: &Op) -> Vec<u8> {
    value_from_json("value", &op.args["value"]).unwrap_or_default()
}

fn number(op: &Op, field: &str) -> i64 {
    op.args.get(field).and_then(Value::as_i64).unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Parsing helpers. Each returns the semantic args object, or `{"error": …}`.
// ---------------------------------------------------------------------------

fn text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

/// A key, as the one representation every command shares.
///
/// Real Redis keys are binary-safe; these are not, and that is refused rather than
/// papered over. `text` is lossy, so two different byte strings collapse onto one key —
/// a keyspace where `GET` misses what `SET` wrote, or two keys silently alias, would
/// grade nonsense. No lesson needs a binary key, and the cache already refuses things
/// real Redis accepts (inline commands, `SELECT 1`, RESP3) on exactly this reasoning.
fn key_text(raw: &[u8]) -> Result<String, Value> {
    String::from_utf8(raw.to_vec())
        .map_err(|_| json!({ "error": "ERR key must be valid UTF-8 text" }))
}

fn wrong_args(name: &str) -> Value {
    json!({
        "error": format!("ERR wrong number of arguments for '{}' command", name.to_lowercase())
    })
}

fn syntax_error() -> Value {
    json!({ "error": "ERR syntax error" })
}

fn not_an_integer() -> Value {
    json!({ "error": "ERR value is not an integer or out of range" })
}

fn invalid_expire(command: &str) -> Reply {
    Reply::Error(format!("ERR invalid expire time in '{command}' command"))
}

/// Map a fixed-arity command positionally onto named fields. A `key` field goes through
/// [`key_text`]; everything else through [`value_to_json`], so a binary payload survives
/// the log round trip intact.
fn fixed(name: &str, rest: &[Vec<u8>], fields: &[&str]) -> Value {
    if rest.len() != fields.len() {
        return wrong_args(name);
    }
    let mut args = Map::new();
    for (field, raw) in fields.iter().zip(rest) {
        let value = match *field {
            "key" => match key_text(raw) {
                Ok(key) => Value::String(key),
                Err(error) => return error,
            },
            _ => value_to_json(raw),
        };
        args.insert(field.to_string(), value);
    }
    Value::Object(args)
}

fn key_list(name: &str, rest: &[Vec<u8>]) -> Value {
    if rest.is_empty() {
        return wrong_args(name);
    }
    let mut keys = Vec::with_capacity(rest.len());
    for raw in rest {
        match key_text(raw) {
            Ok(key) => keys.push(key),
            Err(error) => return error,
        }
    }
    json!({ "keys": keys })
}

fn optional_text(name: &str, rest: &[Vec<u8>], field: &str) -> Value {
    match rest.len() {
        0 => json!({ field: Value::Null }),
        1 => json!({ field: text(&rest[0]) }),
        _ => wrong_args(name),
    }
}

fn parse_subcommand(name: &str, rest: &[Vec<u8>], required: bool) -> Value {
    if rest.is_empty() && required {
        return wrong_args(name);
    }
    let subcommand = rest.first().map(|raw| text(raw).to_uppercase());
    json!({
        "subcommand": subcommand,
        "args": rest.iter().skip(1).map(|raw| text(raw)).collect::<Vec<_>>(),
    })
}

fn whole_number(raw: &[u8]) -> Option<i64> {
    text(raw).parse().ok()
}

fn parse_setex(rest: &[Vec<u8>]) -> Value {
    if rest.len() != 3 {
        return wrong_args("SETEX");
    }
    let key = match key_text(&rest[0]) {
        Ok(key) => key,
        Err(error) => return error,
    };
    let Some(seconds) = whole_number(&rest[1]) else {
        return not_an_integer();
    };
    json!({
        "key": key,
        "value": value_to_json(&rest[2]),
        "ttl_ms": seconds.saturating_mul(1000),
    })
}

fn parse_expire(rest: &[Vec<u8>]) -> Value {
    if rest.len() != 2 {
        return wrong_args("EXPIRE");
    }
    let key = match key_text(&rest[0]) {
        Ok(key) => key,
        Err(error) => return error,
    };
    match whole_number(&rest[1]) {
        None => not_an_integer(),
        Some(seconds) => json!({ "key": key, "ttl_ms": seconds.saturating_mul(1000) }),
    }
}

fn parse_incrby(rest: &[Vec<u8>]) -> Value {
    if rest.len() != 2 {
        return wrong_args("INCRBY");
    }
    let key = match key_text(&rest[0]) {
        Ok(key) => key,
        Err(error) => return error,
    };
    match whole_number(&rest[1]) {
        None => not_an_integer(),
        Some(delta) => json!({ "key": key, "delta": delta }),
    }
}

fn parse_select(rest: &[Vec<u8>]) -> Value {
    if rest.len() != 1 {
        return wrong_args("SELECT");
    }
    match whole_number(&rest[0]) {
        None => not_an_integer(),
        Some(index) => json!({ "index": index }),
    }
}

/// `HELLO [protover]`. Real Redis also takes `AUTH user pass` and `SETNAME name`; this
/// cache implements neither, and swallowing them would let a lesson hand a student a
/// `redis://:pw@cache:6379` URL and grade as though a password had been checked.
fn parse_hello(rest: &[Vec<u8>]) -> Value {
    match rest.len() {
        0 => json!({ "protocol": Value::Null }),
        1 => match whole_number(&rest[0]) {
            Some(protocol) => json!({ "protocol": protocol }),
            None => json!({ "error": NOPROTO }),
        },
        _ => json!({
            "error": format!("ERR Syntax error in HELLO option '{}'", text(&rest[1]))
        }),
    }
}

/// `SET key value [EX s | PX ms | KEEPTTL] [NX | XX]`. Options the cache does not
/// implement are a syntax error, never silently dropped — a lesson whose `SET ... GET`
/// was ignored would grade a behaviour that never happened. Mutually exclusive options
/// (`NX XX`, `EX` twice) are a syntax error for the same reason: real Redis refuses
/// them, so letting last-one-win here would teach a rule that does not hold.
fn parse_set(rest: &[Vec<u8>]) -> Value {
    if rest.len() < 2 {
        return wrong_args("SET");
    }
    let key = match key_text(&rest[0]) {
        Ok(key) => key,
        Err(error) => return error,
    };
    let mut ttl_ms: Option<i64> = None;
    let mut exists_mode: Option<&str> = None;
    let mut keep_ttl = false;

    let mut index = 2;
    while index < rest.len() {
        let option = text(&rest[index]).to_uppercase();
        let mut multiplier = 0;
        match option.as_str() {
            "NX" | "XX" if exists_mode.is_some() => return syntax_error(),
            "NX" => exists_mode = Some("NX"),
            "XX" => exists_mode = Some("XX"),
            "KEEPTTL" if keep_ttl => return syntax_error(),
            "KEEPTTL" => keep_ttl = true,
            "EX" | "PX" if ttl_ms.is_some() => return syntax_error(),
            "EX" => multiplier = 1000,
            "PX" => multiplier = 1,
            _ => return syntax_error(),
        }
        index += 1;
        if multiplier == 0 {
            continue;
        }
        let Some(amount) = rest.get(index).and_then(|raw| whole_number(raw)) else {
            return syntax_error();
        };
        if amount <= 0 {
            return json!({ "error": "ERR invalid expire time in 'set' command" });
        }
        ttl_ms = Some(amount.saturating_mul(multiplier));
        index += 1;
    }

    if keep_ttl && ttl_ms.is_some() {
        return syntax_error();
    }
    json!({
        "key": key,
        "value": value_to_json(&rest[1]),
        "ttl_ms": ttl_ms,
        "exists_mode": exists_mode,
        "keep_ttl": keep_ttl,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn argv(line: &str) -> Vec<Vec<u8>> {
        line.split(' ')
            .map(|word| word.as_bytes().to_vec())
            .collect()
    }

    fn run(engine: &mut Engine, line: &str) -> Reply {
        execute(engine, &parse(&argv(line)))
    }

    fn args_of(line: &str) -> Value {
        parse(&argv(line)).args
    }

    fn error_of(line: &str) -> String {
        match run(&mut Engine::default(), line) {
            Reply::Error(message) => message,
            other => panic!("{line} should have errored, got {other:?}"),
        }
    }

    #[test]
    fn get_set_del_exists_round_trip() {
        let mut engine = Engine::default();
        assert_eq!(run(&mut engine, "GET user:1"), Reply::Nil);
        assert_eq!(run(&mut engine, "SET user:1 ada"), Reply::ok());
        assert_eq!(run(&mut engine, "GET user:1"), Reply::bulk("ada"));
        assert_eq!(run(&mut engine, "EXISTS user:1 nope"), Reply::Int(1));
        assert_eq!(run(&mut engine, "DEL user:1 nope"), Reply::Int(1));
        assert_eq!(run(&mut engine, "GET user:1"), Reply::Nil);
    }

    #[test]
    fn mget_returns_one_slot_per_key_in_order() {
        let mut engine = Engine::default();
        run(&mut engine, "SET a 1");
        run(&mut engine, "SET c 3");
        assert_eq!(
            run(&mut engine, "MGET a b c"),
            Reply::Array(vec![Reply::bulk("1"), Reply::Nil, Reply::bulk("3")])
        );
    }

    #[test]
    fn expiry_is_driven_by_the_logical_clock() {
        let mut engine = Engine::default();
        run(&mut engine, "SET user:1 ada EX 60");
        assert_eq!(run(&mut engine, "TTL user:1"), Reply::Int(60));
        engine.advance_ms(59_000);
        assert_eq!(run(&mut engine, "TTL user:1"), Reply::Int(1));
        engine.advance_ms(1_000);
        assert_eq!(run(&mut engine, "GET user:1"), Reply::Nil);
        assert_eq!(run(&mut engine, "TTL user:1"), Reply::Int(-2));
    }

    #[test]
    fn ttl_reports_minus_one_for_a_persistent_key() {
        let mut engine = Engine::default();
        run(&mut engine, "SET k v");
        assert_eq!(run(&mut engine, "TTL k"), Reply::Int(-1));
        assert_eq!(run(&mut engine, "EXPIRE k 5"), Reply::Int(1));
        assert_eq!(run(&mut engine, "TTL k"), Reply::Int(5));
        assert_eq!(run(&mut engine, "EXPIRE missing 5"), Reply::Int(0));
    }

    #[test]
    fn a_non_positive_expire_deletes_the_key() {
        let mut engine = Engine::default();
        run(&mut engine, "SET k v");
        assert_eq!(run(&mut engine, "EXPIRE k 0"), Reply::Int(1));
        assert_eq!(run(&mut engine, "GET k"), Reply::Nil);
    }

    #[test]
    fn conditional_set_honours_nx_and_xx() {
        let mut engine = Engine::default();
        assert_eq!(run(&mut engine, "SET k a XX"), Reply::Nil);
        assert_eq!(run(&mut engine, "SET k a NX"), Reply::ok());
        assert_eq!(run(&mut engine, "SET k b NX"), Reply::Nil);
        assert_eq!(run(&mut engine, "GET k"), Reply::bulk("a"));
        assert_eq!(run(&mut engine, "SET k b XX"), Reply::ok());
        assert_eq!(run(&mut engine, "GET k"), Reply::bulk("b"));
    }

    #[test]
    fn setnx_and_setex_match_their_shorthand_semantics() {
        let mut engine = Engine::default();
        assert_eq!(run(&mut engine, "SETNX k a"), Reply::Int(1));
        assert_eq!(run(&mut engine, "SETNX k b"), Reply::Int(0));
        assert_eq!(run(&mut engine, "SETEX s 30 v"), Reply::ok());
        assert_eq!(run(&mut engine, "TTL s"), Reply::Int(30));
        assert_eq!(
            error_of("SETEX s 0 v"),
            "ERR invalid expire time in 'setex' command"
        );
    }

    #[test]
    fn set_px_and_keepttl_cover_the_other_lifetime_forms() {
        let mut engine = Engine::default();
        run(&mut engine, "SET k a PX 1500");
        assert_eq!(run(&mut engine, "TTL k"), Reply::Int(2));
        run(&mut engine, "SET k b KEEPTTL");
        assert_eq!(run(&mut engine, "GET k"), Reply::bulk("b"));
        assert_eq!(run(&mut engine, "TTL k"), Reply::Int(2));
        // A plain SET drops the deadline.
        run(&mut engine, "SET k c");
        assert_eq!(run(&mut engine, "TTL k"), Reply::Int(-1));
    }

    #[test]
    fn counters_increment_and_report_real_errors() {
        let mut engine = Engine::default();
        assert_eq!(run(&mut engine, "INCR hits"), Reply::Int(1));
        assert_eq!(run(&mut engine, "INCRBY hits 41"), Reply::Int(42));
        assert_eq!(run(&mut engine, "INCRBY hits -42"), Reply::Int(0));
        run(&mut engine, "SET name ada");
        assert_eq!(
            run(&mut engine, "INCR name"),
            Reply::Error("ERR value is not an integer or out of range".into())
        );
    }

    #[test]
    fn handshake_commands_let_a_real_client_in() {
        let mut engine = Engine::default();
        assert_eq!(run(&mut engine, "PING"), Reply::Simple("PONG".into()));
        assert_eq!(run(&mut engine, "PING hi"), Reply::bulk("hi"));
        assert_eq!(run(&mut engine, "SELECT 0"), Reply::ok());
        assert_eq!(
            run(&mut engine, "CLIENT SETINFO LIB-NAME redis-py"),
            Reply::ok()
        );
        assert_eq!(run(&mut engine, "CLIENT ID"), Reply::Int(1));
        assert_eq!(run(&mut engine, "COMMAND DOCS"), Reply::Array(Vec::new()));
        assert_eq!(run(&mut engine, "QUIT"), Reply::ok());
    }

    #[test]
    fn info_carries_the_fields_a_ready_check_waits_for() {
        let Reply::Bulk(body) = run(&mut Engine::default(), "INFO") else {
            panic!("INFO must reply with a bulk string");
        };
        let body = String::from_utf8(body).unwrap();
        // ioredis blocks until it sees `loading:0`; redis clients read `redis_version`.
        assert!(body.contains("loading:0"), "{body}");
        assert!(body.contains("redis_version:"), "{body}");
        assert!(body.contains("role:master"), "{body}");
    }

    #[test]
    fn hello_advertises_resp2_and_refuses_resp3() {
        let mut engine = Engine::default();
        let Reply::Array(fields) = run(&mut engine, "HELLO") else {
            panic!("HELLO must reply with a map-shaped array");
        };
        assert_eq!(fields[0], Reply::bulk("server"));
        assert!(fields.contains(&Reply::Int(2)), "proto must be 2");
        assert_eq!(run(&mut engine, "HELLO 2"), Reply::Array(fields));
        // Refusing v3 is the signal clients use to fall back to RESP2.
        assert_eq!(error_of("HELLO 3"), "NOPROTO unsupported protocol version");
        assert_eq!(
            error_of("HELLO three"),
            "NOPROTO unsupported protocol version"
        );
    }

    /// Auth is not implemented, so a `HELLO ... AUTH` that appeared to succeed would let
    /// a lesson believe a password was checked.
    #[test]
    fn hello_refuses_the_options_it_does_not_implement() {
        assert_eq!(
            error_of("HELLO 2 AUTH default hunter2"),
            "ERR Syntax error in HELLO option 'AUTH'"
        );
        assert_eq!(
            error_of("HELLO 2 SETNAME app"),
            "ERR Syntax error in HELLO option 'SETNAME'"
        );
    }

    #[test]
    fn a_second_database_is_refused_rather_than_aliased() {
        assert_eq!(error_of("SELECT 1"), "ERR DB index is out of range");
    }

    #[test]
    fn malformed_commands_decode_to_an_op_carrying_their_error() {
        for (line, expected) in [
            ("GET", "ERR wrong number of arguments for 'get' command"),
            ("GET a b", "ERR wrong number of arguments for 'get' command"),
            ("DEL", "ERR wrong number of arguments for 'del' command"),
            ("SET k", "ERR wrong number of arguments for 'set' command"),
            ("SET k v EX", "ERR syntax error"),
            ("SET k v EX soon", "ERR syntax error"),
            ("SET k v GET", "ERR syntax error"),
            ("SET k v EX 5 KEEPTTL", "ERR syntax error"),
            // Mutually exclusive options, exactly as real Redis refuses them.
            ("SET k v NX XX", "ERR syntax error"),
            ("SET k v XX NX", "ERR syntax error"),
            ("SET k v EX 5 EX 10", "ERR syntax error"),
            ("SET k v EX 5 PX 10", "ERR syntax error"),
            ("SET k v KEEPTTL KEEPTTL", "ERR syntax error"),
            ("SET k v EX 0", "ERR invalid expire time in 'set' command"),
            (
                "EXPIRE k soon",
                "ERR value is not an integer or out of range",
            ),
            (
                "INCRBY k lots",
                "ERR value is not an integer or out of range",
            ),
            (
                "PING a b",
                "ERR wrong number of arguments for 'ping' command",
            ),
            (
                "CLIENT",
                "ERR wrong number of arguments for 'client' command",
            ),
            ("CLIENT NOPE", "ERR unknown subcommand 'NOPE'"),
            ("FLUSHALL", "ERR unknown command 'FLUSHALL'"),
        ] {
            assert_eq!(error_of(line), expected, "{line}");
        }
    }

    #[test]
    fn an_unknown_command_is_still_logged_under_its_own_name() {
        let op = parse(&argv("FLUSHALL now"));
        assert_eq!(op.op, "FLUSHALL");
        assert!(
            !OP_NAMES.contains(&"FLUSHALL"),
            "and so is not an installable trigger"
        );
    }

    #[test]
    fn command_names_are_case_insensitive() {
        let mut engine = Engine::default();
        run(&mut engine, "set k v");
        assert_eq!(run(&mut engine, "gEt k"), Reply::bulk("v"));
        assert_eq!(parse(&argv("get k")).op, "GET");
    }

    #[test]
    fn logged_args_are_semantic_not_raw_argv() {
        assert_eq!(args_of("GET user:1"), json!({ "key": "user:1" }));
        assert_eq!(args_of("MGET a b"), json!({ "keys": ["a", "b"] }));
        assert_eq!(
            args_of("SET user:1 ada EX 60 NX"),
            json!({ "key": "user:1", "value": "ada", "ttl_ms": 60_000,
                    "exists_mode": "NX", "keep_ttl": false })
        );
        assert_eq!(
            args_of("EXPIRE k 5"),
            json!({ "key": "k", "ttl_ms": 5_000 })
        );
        assert_eq!(args_of("INCRBY k 3"), json!({ "key": "k", "delta": 3 }));
    }

    #[test]
    fn keys_of_covers_both_arg_shapes() {
        assert_eq!(keys_of(&parse(&argv("GET a"))), vec!["a".to_string()]);
        assert_eq!(
            keys_of(&parse(&argv("MGET a b"))),
            vec!["a".to_string(), "b".to_string()]
        );
        assert!(keys_of(&parse(&argv("PING"))).is_empty());
    }

    #[test]
    fn binary_values_survive_the_semantic_round_trip() {
        let mut engine = Engine::default();
        let op = parse(&[b"SET".to_vec(), b"k".to_vec(), vec![0xff, 0x01]]);
        assert_eq!(execute(&mut engine, &op), Reply::ok());
        assert_eq!(engine.get("k"), Some(vec![0xff, 0x01]));
    }

    /// Keys have one representation across every command. Lossy decoding would have made
    /// `GET` miss what `SET` wrote — and collapsed every non-UTF-8 key onto one entry.
    #[test]
    fn a_non_utf8_key_is_refused_by_every_command_that_takes_one() {
        let bad = vec![0x66, 0xff, 0x67];
        let expected = "ERR key must be valid UTF-8 text";
        let commands: [Vec<Vec<u8>>; 8] = [
            vec![b"GET".to_vec(), bad.clone()],
            vec![b"TTL".to_vec(), bad.clone()],
            vec![b"INCR".to_vec(), bad.clone()],
            vec![b"SETNX".to_vec(), bad.clone(), b"v".to_vec()],
            vec![b"SET".to_vec(), bad.clone(), b"v".to_vec()],
            vec![b"SETEX".to_vec(), bad.clone(), b"5".to_vec(), b"v".to_vec()],
            vec![b"EXPIRE".to_vec(), bad.clone(), b"5".to_vec()],
            vec![b"MGET".to_vec(), b"ok".to_vec(), bad.clone()],
        ];
        for argv in commands {
            let op = parse(&argv);
            assert_eq!(
                execute(&mut Engine::default(), &op),
                Reply::Error(expected.to_string()),
                "{} must refuse a non-UTF-8 key",
                op.op
            );
        }
    }

    #[test]
    fn every_listed_op_name_has_an_execute_arm() {
        // The two lists must not drift: an op in `OP_NAMES` is installable as a fault
        // trigger, so one without an arm would grade against an error reply.
        for name in OP_NAMES {
            let op = Op {
                op: name.to_string(),
                args: json!({}),
            };
            let reply = execute(&mut Engine::default(), &op);
            assert_ne!(
                reply,
                Reply::Error(format!("ERR unknown command '{name}'")),
                "{name} has no execute arm"
            );
        }
    }
}
