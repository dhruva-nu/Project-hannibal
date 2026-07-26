//! End-to-end acceptance test for Phase 1 (#134) — the cache-aside milestone.
//!
//! The centrepiece is [`cache_aside_milestone_lesson`]: a stand-in for the student's
//! `get_user_profile()`, written against the emulator over real RESP2, graded the way
//! the harness will grade it — **from the op log**, not from the return value. The
//! remaining tests cover the pieces that lesson depends on: deterministic expiry, the
//! cache's own fault actions, and the generic ones firing over a real protocol.
//!
//! Client-library compatibility (redis-py, ioredis) is proved separately by
//! `compat/`, which runs this same scenario through the blessed clients in CI.

mod common;

use cannae_cache::CacheEmulator;
use cannae_core::Emulator;
use common::{Conn, Harness};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

async fn start() -> Harness {
    Harness::start("cache", |port| {
        Arc::new(CacheEmulator::with_port(port)) as Arc<dyn Emulator>
    })
    .await
}

/// One RESP2 reply, in the shape a test wants to assert on.
#[derive(Debug, PartialEq, Eq)]
enum Resp {
    Simple(String),
    Error(String),
    Int(i64),
    Bulk(Option<String>),
    Array(Vec<Resp>),
}

impl Resp {
    fn bulk(text: &str) -> Self {
        Resp::Bulk(Some(text.to_string()))
    }
}

/// A minimal RESP2 client: encode a command, read one reply. Deliberately hand-rolled
/// rather than pulled from a crate — this test must exercise the bytes on the wire.
struct RespClient {
    conn: Conn,
}

impl RespClient {
    async fn open(harness: &Harness) -> Self {
        RespClient {
            conn: harness.connect().await,
        }
    }

    /// Send one command and read its reply. `None` means the server closed the socket.
    async fn call(&mut self, argv: &[&str]) -> Option<Resp> {
        let mut frame = format!("*{}\r\n", argv.len()).into_bytes();
        for arg in argv {
            frame.extend_from_slice(format!("${}\r\n{arg}\r\n", arg.len()).as_bytes());
        }
        self.conn.write(&frame).await;
        read_reply(&mut self.conn).await
    }

    /// The reply as a bulk string, treating a nil as a cache miss.
    async fn get(&mut self, key: &str) -> Option<String> {
        match self.call(&["GET", key]).await {
            Some(Resp::Bulk(value)) => value,
            other => panic!("GET {key} should reply with a bulk string, got {other:?}"),
        }
    }
}

/// Boxed because a RESP array's elements are themselves replies, and an `async fn`
/// cannot recurse without an indirection.
fn read_reply(conn: &mut Conn) -> Pin<Box<dyn Future<Output = Option<Resp>> + Send + '_>> {
    Box::pin(async move {
        let line = conn.read_line_or_timeout().await?;
        let body = line.trim_end_matches(['\r', '\n']).to_string();
        let (tag, rest) = body.split_at(1);
        let reply = match tag {
            "+" => Resp::Simple(rest.into()),
            "-" => Resp::Error(rest.into()),
            ":" => Resp::Int(rest.parse().expect("integer reply")),
            "$" => match rest.parse::<i64>().expect("bulk length") {
                -1 => Resp::Bulk(None),
                length => {
                    // +2 consumes the trailing CRLF the payload is followed by.
                    let bytes = conn.read_bytes(length as usize + 2).await?;
                    let text = String::from_utf8_lossy(&bytes[..length as usize]);
                    Resp::bulk(&text)
                }
            },
            "*" => {
                let count = rest.parse::<i64>().expect("array length").max(0);
                let mut items = Vec::new();
                for _ in 0..count {
                    items.push(read_reply(conn).await?);
                }
                Resp::Array(items)
            }
            other => panic!("unknown RESP type tag {other:?} in {body:?}"),
        };
        Some(reply)
    })
}

/// The backing store the cache sits in front of. Its read count is the whole point:
/// a working cache-aside implementation reads it once, not twice.
#[derive(Default)]
struct BackingStore {
    rows: HashMap<String, String>,
    reads: u32,
}

impl BackingStore {
    fn with_user(id: &str, profile: &str) -> Self {
        let mut store = BackingStore::default();
        store.rows.insert(id.to_string(), profile.to_string());
        store
    }

    fn read(&mut self, id: &str) -> Option<String> {
        self.reads += 1;
        self.rows.get(id).cloned()
    }
}

/// The lesson's target implementation, exactly as a student would write it against a
/// real Redis: look in the cache, fall back to the store on a miss, populate, return.
async fn get_user_profile(
    cache: &mut RespClient,
    store: &mut BackingStore,
    user_id: &str,
) -> Option<String> {
    let key = format!("user:{user_id}");
    if let Some(cached) = cache.get(&key).await {
        return Some(cached);
    }
    let profile = store.read(user_id)?;
    cache
        .call(&["SET", &key, &profile, "EX", "60"])
        .await
        .expect("the cache must accept the populating write");
    Some(profile)
}

/// The acceptance criterion for #134, end to end: cache-aside graded from the op log,
/// plus a forced-expiry scenario proving the fallback path.
#[tokio::test]
async fn cache_aside_milestone_lesson() {
    let h = start().await;
    h.seed(json!({ "keys": {} })).await; // a cold cache
    let mut store = BackingStore::with_user("1", r#"{"name":"Ada"}"#);
    let mut cache = RespClient::open(&h).await;

    // --- First call: a miss, then a populate. ---
    let profile = get_user_profile(&mut cache, &mut store, "1").await;
    assert_eq!(profile.as_deref(), Some(r#"{"name":"Ada"}"#));
    assert_eq!(
        h.op_names().await,
        vec!["connect", "GET", "SET"],
        "the cache must be checked BEFORE the backing store, and populated AFTER the miss"
    );
    let log = h.log().await;
    assert_eq!(log[1]["args"]["key"], "user:1");
    assert_eq!(
        log[2]["args"],
        json!({
            "key": "user:1", "value": r#"{"name":"Ada"}"#,
            "ttl_ms": 60_000, "exists_mode": null, "keep_ttl": false
        })
    );
    assert_eq!(store.reads, 1);

    // --- Second call: a hit. No SET, and the store is not touched again. ---
    assert_eq!(
        get_user_profile(&mut cache, &mut store, "1")
            .await
            .as_deref(),
        Some(r#"{"name":"Ada"}"#)
    );
    assert_eq!(h.op_names().await, vec!["connect", "GET", "SET", "GET"]);
    assert_eq!(
        store.reads, 1,
        "a cache hit must not read the backing store"
    );

    // --- Forced expiry: the entry ages out, so the next call falls back and repopulates. ---
    // No sleep: the harness advances the logical clock past the 60s TTL.
    h.arm(json!({ "action": "advance_clock", "params": { "seconds": 61 } }))
        .await;
    assert_eq!(
        get_user_profile(&mut cache, &mut store, "1")
            .await
            .as_deref(),
        Some(r#"{"name":"Ada"}"#)
    );
    assert_eq!(
        h.op_names().await,
        vec!["connect", "GET", "SET", "GET", "GET", "SET"],
        "an expired entry must send the student back to the backing store"
    );
    assert_eq!(store.reads, 2);
    assert_eq!(h.state().await["keys"]["user:1"]["ttl_ms"], 60_000);
}

/// The other half of the acceptance criterion: an expiry the harness scripts *as a
/// fault*, targeted at one key and fired by the student's own read.
#[tokio::test]
async fn expire_key_forces_a_miss_on_the_next_read() {
    let h = start().await;
    h.seed(json!({ "keys": { "user:1": "ada", "user:2": "grace" } }))
        .await;
    h.arm(json!({
        "action": "expire_key",
        "after": { "op_matches": "read", "count": 1 },
        "params": { "key": "user:1" }
    }))
    .await;

    let mut cache = RespClient::open(&h).await;
    // The rule is scoped to user:1, so a read of user:2 must not consume it.
    assert_eq!(cache.get("user:2").await.as_deref(), Some("grace"));
    assert_eq!(cache.get("user:1").await, None, "the fault fires here");
    assert_eq!(
        cache.get("user:1").await,
        None,
        "and the key is really gone"
    );
    assert_eq!(cache.get("user:2").await.as_deref(), Some("grace"));

    let log = h.log().await;
    assert_eq!(log[2]["op"], "GET");
    assert_eq!(log[2]["fault"], "expire_key");
    assert_eq!(log[1]["fault"], Value::Null);
    assert_eq!(
        h.state().await["keys"],
        json!({ "user:2": { "value": "grace", "ttl_ms": null } })
    );
}

#[tokio::test]
async fn serve_stale_returns_the_old_value_exactly_once() {
    let h = start().await;
    h.seed(json!({ "keys": { "user:1": "ada@v2" } })).await;
    h.arm(json!({
        "action": "serve_stale",
        "after": { "op_matches": "GET", "count": 1 },
        "params": { "key": "user:1", "value": "ada@v1" }
    }))
    .await;

    let mut cache = RespClient::open(&h).await;
    assert_eq!(cache.get("user:1").await.as_deref(), Some("ada@v1"));
    assert_eq!(
        cache.get("user:1").await.as_deref(),
        Some("ada@v2"),
        "the stored value was never actually changed"
    );
    assert_eq!(h.log().await[1]["fault"], "serve_stale");
}

/// `times` covers "the retry fails too" without arming a second rule.
#[tokio::test]
async fn a_repeated_fault_covers_the_retry() {
    let h = start().await;
    h.seed(json!({ "keys": { "user:1": "ada" } })).await;
    h.arm(json!({
        "action": "expire_key",
        "after": { "op_matches": "GET", "count": 1 },
        "times": 2
    }))
    .await;

    let mut cache = RespClient::open(&h).await;
    for attempt in 1..=2 {
        assert_eq!(cache.get("user:1").await, None, "attempt {attempt}");
        assert_eq!(
            cache.call(&["SET", "user:1", "ada"]).await,
            Some(Resp::Simple("OK".into()))
        );
    }
    // The rule has retired; the third read succeeds.
    assert_eq!(cache.get("user:1").await.as_deref(), Some("ada"));
}

#[tokio::test]
async fn the_command_surface_a_caching_lesson_needs_works_over_the_wire() {
    let h = start().await;
    h.seed(json!({ "keys": {} })).await;
    let mut cache = RespClient::open(&h).await;

    assert_eq!(
        cache.call(&["PING"]).await,
        Some(Resp::Simple("PONG".into()))
    );
    assert_eq!(
        cache.call(&["SET", "a", "1"]).await,
        Some(Resp::Simple("OK".into()))
    );
    assert_eq!(cache.call(&["EXISTS", "a", "b"]).await, Some(Resp::Int(1)));
    assert_eq!(cache.call(&["SETNX", "a", "2"]).await, Some(Resp::Int(0)));
    assert_eq!(cache.call(&["INCR", "hits"]).await, Some(Resp::Int(1)));
    assert_eq!(
        cache.call(&["INCRBY", "hits", "9"]).await,
        Some(Resp::Int(10))
    );
    assert_eq!(cache.call(&["EXPIRE", "a", "30"]).await, Some(Resp::Int(1)));
    assert_eq!(cache.call(&["TTL", "a"]).await, Some(Resp::Int(30)));
    assert_eq!(
        cache.call(&["MGET", "a", "missing", "hits"]).await,
        Some(Resp::Array(vec![
            Resp::bulk("1"),
            Resp::Bulk(None),
            Resp::bulk("10")
        ]))
    );
    assert_eq!(cache.call(&["DEL", "a", "hits"]).await, Some(Resp::Int(2)));
    assert_eq!(
        cache.call(&["SETEX", "s", "5", "v"]).await,
        Some(Resp::Simple("OK".into()))
    );
    assert_eq!(cache.call(&["TTL", "s"]).await, Some(Resp::Int(5)));
    // A binary-safe value round trips, CRLF and all.
    assert_eq!(
        cache.call(&["SET", "raw", "a\r\nb"]).await,
        Some(Resp::Simple("OK".into()))
    );
    assert_eq!(cache.get("raw").await.as_deref(), Some("a\r\nb"));
}

/// A student's mistake must come back as the error a real Redis returns, on a
/// connection that stays open — and it must be in the log the grader reads.
#[tokio::test]
async fn client_errors_are_real_resp_errors_and_are_logged() {
    let h = start().await;
    let mut cache = RespClient::open(&h).await;

    assert_eq!(
        cache.call(&["GET"]).await,
        Some(Resp::Error(
            "ERR wrong number of arguments for 'get' command".into()
        ))
    );
    assert_eq!(
        cache.call(&["FLUSHALL"]).await,
        Some(Resp::Error("ERR unknown command 'FLUSHALL'".into()))
    );
    assert_eq!(
        cache.call(&["PING"]).await,
        Some(Resp::Simple("PONG".into()))
    );
    assert_eq!(
        h.op_names().await,
        vec!["connect", "GET", "FLUSHALL", "PING"]
    );
}

/// The generic actions are the kit's, unchanged since Phase 0 — this proves they
/// land correctly on a real protocol rather than on echo's line format.
#[tokio::test]
async fn generic_actions_speak_resp_when_they_fire() {
    let h = start().await;
    h.seed(json!({ "keys": { "user:1": "ada" } })).await;
    h.arm(json!({
        "action": "inject_error",
        "after": { "op_matches": "GET", "count": 1 },
        "params": { "resp_error": "READONLY You can't write against a read only replica." }
    }))
    .await;
    h.arm(json!({
        "action": "kill_connection",
        "after": { "op_matches": "write", "count": 1 }
    }))
    .await;

    let mut cache = RespClient::open(&h).await;
    assert_eq!(
        cache.call(&["GET", "user:1"]).await,
        Some(Resp::Error(
            "READONLY You can't write against a read only replica.".into()
        ))
    );
    // The connection survives an injected error…
    assert_eq!(cache.get("user:1").await.as_deref(), Some("ada"));
    // …but the first write drops it, exactly as a server crash would.
    assert_eq!(cache.call(&["SET", "user:1", "grace"]).await, None);

    let log = h.wait_for_log(5).await; // connect, GET, GET, SET, disconnect
    assert_eq!(log[1]["fault"], "inject_error");
    assert_eq!(log[3]["fault"], "kill_connection");
    assert_eq!(log[4]["op"], "disconnect");
    // The killed op was logged but never executed.
    assert_eq!(h.state().await["keys"]["user:1"]["value"], "ada");
}

#[tokio::test]
async fn a_cache_rule_is_validated_when_it_is_armed() {
    let h = start().await;
    let bad = reqwest::StatusCode::BAD_REQUEST;
    let read_trigger = json!({ "op_matches": "read", "count": 1 });

    // `serve_stale` with nothing stale to serve could only ever fire into nothing.
    assert_eq!(
        h.fault(json!({ "action": "serve_stale", "after": read_trigger }))
            .await,
        bad
    );
    // A key-scoped rule whose key is not a string would silently match nothing.
    assert_eq!(
        h.fault(json!({ "action": "expire_key", "after": read_trigger, "params": { "key": 1 } }))
            .await,
        bad
    );
    // A command the cache does not implement is not an installable trigger.
    assert_eq!(
        h.fault(json!({ "action": "expire_key",
                        "after": { "op_matches": "FLUSHALL", "count": 1 } }))
            .await,
        bad
    );
    // An immediate action takes no trigger, and needs a duration it can act on.
    assert_eq!(
        h.fault(
            json!({ "action": "advance_clock", "after": read_trigger, "params": { "seconds": 1 } })
        )
        .await,
        bad
    );
    assert_eq!(h.fault(json!({ "action": "advance_clock" })).await, bad);
    assert_eq!(
        h.fault(json!({ "action": "advance_clock", "params": { "seconds": 1, "ms": 1 } }))
            .await,
        bad
    );

    // The well-formed forms all install.
    h.arm(json!({ "action": "serve_stale", "after": read_trigger, "params": { "value": "old" } }))
        .await;
    h.arm(json!({ "action": "expire_key", "after": { "op_matches": "write", "count": 1 } }))
        .await;
    h.arm(json!({ "action": "advance_clock", "params": { "ms": 500 } }))
        .await;
}

#[tokio::test]
async fn a_malformed_lesson_fixture_is_rejected_at_seed_time() {
    let h = start().await;
    let status = h
        .http
        .post(format!("{}/seed", h.base))
        .json(&json!({ "emulator": "cache", "keys": { "k": { "value": "v", "ttl": 60 } } }))
        .send()
        .await
        .unwrap()
        .status();
    assert_eq!(
        status,
        reqwest::StatusCode::BAD_REQUEST,
        "`ttl` is not a lifetime field"
    );
}

/// `/reset` must rewind the clock too, or the second test case in a lesson would run
/// against a keyspace that has already aged.
#[tokio::test]
async fn reset_rewinds_the_keyspace_the_clock_and_the_log() {
    let h = start().await;
    h.seed(json!({ "keys": { "user:1": { "value": "ada", "ttl_seconds": 60 } } }))
        .await;

    let mut cache = RespClient::open(&h).await;
    cache.call(&["SET", "scratch", "x"]).await;
    h.arm(json!({ "action": "advance_clock", "params": { "seconds": 61 } }))
        .await;
    assert_eq!(cache.get("user:1").await, None, "aged out");

    h.reset().await;
    assert!(h.log().await.is_empty());
    assert_eq!(
        h.state().await,
        json!({ "clock_ms": 0,
                "keys": { "user:1": { "value": "ada", "ttl_ms": 60_000 } } })
    );
}

/// The determinism guarantee, on a real protocol: identical scripted runs — including
/// a clock advance and a fired fault — produce byte-identical op logs.
#[tokio::test]
async fn the_same_lesson_run_twice_is_byte_identical() {
    let h = start().await;

    async fn scenario(h: &Harness) -> String {
        h.seed(json!({ "keys": {} })).await;
        h.arm(json!({
            "action": "serve_stale",
            "after": { "op_matches": "read", "count": 2 },
            "params": { "value": "stale" }
        }))
        .await;

        let mut cache = RespClient::open(h).await;
        let mut store = BackingStore::with_user("1", "ada");
        get_user_profile(&mut cache, &mut store, "1").await;
        h.arm(json!({ "action": "advance_clock", "params": { "seconds": 61 } }))
            .await;
        get_user_profile(&mut cache, &mut store, "1").await;
        cache.call(&["TTL", "user:1"]).await;
        drop(cache);

        // connect, GET (miss), SET, GET (stale), TTL, disconnect
        h.wait_for_log(6).await;
        h.log_text().await
    }

    let first = scenario(&h).await;
    h.reset().await;
    let second = scenario(&h).await;
    assert_eq!(first, second, "op logs must be byte-identical across runs");
}
