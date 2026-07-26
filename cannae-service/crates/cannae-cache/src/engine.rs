//! The keyspace: a dict plus TTL bookkeeping driven by a **logical clock**.
//!
//! Nothing here reads a wall clock. Expiry advances only when the harness says so
//! (`POST /faults {"action": "advance_clock", "seconds": 61}`), which turns "the cache
//! entry expired" into a scripted event instead of a sleep — the property that makes
//! the op log byte-identical across runs.

use serde_json::{json, Map, Value};
use std::collections::BTreeMap;

/// Fields a seed body (or a snapshot) may carry. Anything else is a typo that would
/// otherwise seed nothing at all, so it is rejected.
const SEED_FIELDS: [&str; 3] = ["emulator", "keys", "clock_ms"];

/// Ways one seeded entry may express its lifetime. Exactly one may be present.
const TTL_FIELDS: [&str; 3] = ["ttl_seconds", "ttl_ms", "expires_at_ms"];

pub struct Entry {
    pub value: Vec<u8>,
    /// Logical-clock deadline. `None` means the key never expires.
    pub expires_at_ms: Option<u64>,
}

/// The keyspace. `BTreeMap` (not `HashMap`) so `/state` dumps and snapshots are
/// ordered — a grader diffing them must not see iteration order change between runs.
#[derive(Default)]
pub struct Engine {
    keys: BTreeMap<String, Entry>,
    now_ms: u64,
}

impl Engine {
    pub fn advance_ms(&mut self, delta: u64) {
        self.now_ms = self.now_ms.saturating_add(delta);
    }

    /// Drop `key` if its deadline has passed. Expiry is lazy — checked on access —
    /// so advancing the clock costs nothing and the keyspace stays deterministic.
    fn purge(&mut self, key: &str) {
        let expired = self
            .keys
            .get(key)
            .and_then(|entry| entry.expires_at_ms)
            .is_some_and(|deadline| self.now_ms >= deadline);
        if expired {
            self.keys.remove(key);
        }
    }

    fn purge_all(&mut self) {
        let now = self.now_ms;
        self.keys
            .retain(|_, entry| entry.expires_at_ms.is_none_or(|deadline| now < deadline));
    }

    pub fn get(&mut self, key: &str) -> Option<Vec<u8>> {
        self.purge(key);
        self.keys.get(key).map(|entry| entry.value.clone())
    }

    pub fn exists(&mut self, key: &str) -> bool {
        self.purge(key);
        self.keys.contains_key(key)
    }

    /// Write `key`. `ttl_ms` of `None` clears any existing deadline, matching Redis:
    /// a plain `SET` over a volatile key makes it persistent.
    pub fn set(&mut self, key: &str, value: Vec<u8>, ttl_ms: Option<u64>) {
        let expires_at_ms = ttl_ms.map(|ttl| self.now_ms.saturating_add(ttl));
        self.keys.insert(
            key.to_string(),
            Entry {
                value,
                expires_at_ms,
            },
        );
    }

    /// Write `key` while leaving its current deadline alone (`SET ... KEEPTTL`).
    pub fn set_keep_ttl(&mut self, key: &str, value: Vec<u8>) {
        self.purge(key);
        let expires_at_ms = self.keys.get(key).and_then(|entry| entry.expires_at_ms);
        self.keys.insert(
            key.to_string(),
            Entry {
                value,
                expires_at_ms,
            },
        );
    }

    /// Remove `key`, reporting whether it was live. Used by `DEL` and by the
    /// `expire_key` fault.
    pub fn remove(&mut self, key: &str) -> bool {
        self.purge(key);
        self.keys.remove(key).is_some()
    }

    /// Take `key` out and hand back its entry, so a caller can put it straight back —
    /// how `serve_stale` shows a stale value without corrupting the keyspace.
    pub fn take(&mut self, key: &str) -> Option<Entry> {
        self.purge(key);
        self.keys.remove(key)
    }

    pub fn put(&mut self, key: &str, entry: Entry) {
        self.keys.insert(key.to_string(), entry);
    }

    pub fn expire(&mut self, key: &str, ttl_ms: u64) -> bool {
        self.purge(key);
        let deadline = self.now_ms.saturating_add(ttl_ms);
        match self.keys.get_mut(key) {
            Some(entry) => {
                entry.expires_at_ms = Some(deadline);
                true
            }
            None => false,
        }
    }

    /// Remaining lifetime: `None` if the key is gone, `Some(None)` if it has no
    /// deadline — the two cases `TTL` reports as `-2` and `-1`.
    pub fn ttl_ms(&mut self, key: &str) -> Option<Option<u64>> {
        self.purge(key);
        let entry = self.keys.get(key)?;
        Some(entry.expires_at_ms.map(|at| at.saturating_sub(self.now_ms)))
    }

    /// `INCR` / `INCRBY`. A missing key counts from zero; a non-numeric or overflowing
    /// value is the same error a real Redis returns, so client error handling is real.
    pub fn incr_by(&mut self, key: &str, delta: i64) -> Result<i64, String> {
        let current = match self.get(key) {
            None => 0,
            Some(bytes) => std::str::from_utf8(&bytes)
                .ok()
                .and_then(|text| text.parse::<i64>().ok())
                .ok_or("ERR value is not an integer or out of range")?,
        };
        let next = current
            .checked_add(delta)
            .ok_or("ERR increment or decrement would overflow")?;
        self.set_keep_ttl(key, next.to_string().into_bytes());
        Ok(next)
    }

    /// Replace the whole keyspace and clock from a seed body or a snapshot. One
    /// loader for both: [`Self::snapshot`] emits the canonical `expires_at_ms` form,
    /// which is simply one of the lifetime forms a lesson fixture may also write.
    pub fn load(&mut self, body: &Value) -> Result<(), String> {
        let fields = body
            .as_object()
            .ok_or("seed body must be an object".to_string())?;
        if let Some(unknown) = fields
            .keys()
            .find(|key| !SEED_FIELDS.contains(&key.as_str()))
        {
            return Err(format!(
                "unknown seed field {unknown}; expected one of: {}",
                SEED_FIELDS.join(", ")
            ));
        }

        let clock_ms = match fields.get("clock_ms") {
            None => 0,
            Some(value) => value.as_u64().ok_or("clock_ms must be a whole number")?,
        };
        let entries = match fields.get("keys") {
            None => Map::new(),
            Some(value) => value.as_object().ok_or("keys must be an object")?.clone(),
        };

        let mut loaded = BTreeMap::new();
        for (key, spec) in entries.iter() {
            loaded.insert(key.clone(), parse_entry(key, spec, clock_ms)?);
        }
        self.keys = loaded;
        self.now_ms = clock_ms;
        Ok(())
    }

    /// The canonical form: absolute deadlines, so restoring is exact regardless of
    /// what the clock has done since.
    pub fn snapshot(&self) -> Value {
        let keys: Map<String, Value> = self
            .keys
            .iter()
            .map(|(key, entry)| {
                let entry = json!({
                    "value": value_to_json(&entry.value),
                    "expires_at_ms": entry.expires_at_ms,
                });
                (key.clone(), entry)
            })
            .collect();
        json!({ "clock_ms": self.now_ms, "keys": keys })
    }

    /// What `GET /state` returns: live keys only, with *remaining* TTL — the shape a
    /// grader asserts on ("is user:1 still cached, and for how much longer?").
    pub fn state(&mut self) -> Value {
        self.purge_all();
        let keys: Map<String, Value> = self
            .keys
            .iter()
            .map(|(key, entry)| {
                let ttl_ms = entry.expires_at_ms.map(|at| at.saturating_sub(self.now_ms));
                let entry = json!({ "value": value_to_json(&entry.value), "ttl_ms": ttl_ms });
                (key.clone(), entry)
            })
            .collect();
        json!({ "clock_ms": self.now_ms, "keys": keys })
    }
}

/// Render a stored value for JSON. Cache values are text in every lesson, but the
/// protocol allows arbitrary bytes — those become a byte array so a snapshot round
/// trip is lossless instead of quietly mangling them into replacement characters.
pub(crate) fn value_to_json(bytes: &[u8]) -> Value {
    match std::str::from_utf8(bytes) {
        Ok(text) => Value::String(text.to_string()),
        Err(_) => Value::Array(bytes.iter().map(|byte| json!(byte)).collect()),
    }
}

pub(crate) fn value_from_json(key: &str, value: &Value) -> Result<Vec<u8>, String> {
    match value {
        Value::String(text) => Ok(text.clone().into_bytes()),
        Value::Number(number) => Ok(number.to_string().into_bytes()),
        Value::Array(bytes) => bytes
            .iter()
            .map(|byte| {
                byte.as_u64()
                    .filter(|byte| *byte <= u8::MAX as u64)
                    .map(|byte| byte as u8)
                    .ok_or_else(|| format!("{key}: byte-array values must hold 0..=255"))
            })
            .collect(),
        _ => Err(format!(
            "{key}: value must be a string, number, or byte array"
        )),
    }
}

/// One seeded entry: a bare value, or an object carrying at most one lifetime field.
fn parse_entry(key: &str, spec: &Value, clock_ms: u64) -> Result<Entry, String> {
    let Some(fields) = spec
        .as_object()
        .filter(|fields| fields.contains_key("value"))
    else {
        return Ok(Entry {
            value: value_from_json(key, spec)?,
            expires_at_ms: None,
        });
    };

    let present: Vec<&str> = TTL_FIELDS
        .into_iter()
        .filter(|field| fields.contains_key(*field))
        .collect();
    if present.len() > 1 {
        return Err(format!(
            "{key}: {} are mutually exclusive",
            present.join(" and ")
        ));
    }
    if let Some(unknown) = fields
        .keys()
        .find(|field| *field != "value" && !TTL_FIELDS.contains(&field.as_str()))
    {
        return Err(format!("{key}: unknown entry field {unknown}"));
    }

    let lifetime = |field: &str| -> Result<Option<u64>, String> {
        match fields.get(field) {
            None | Some(Value::Null) => Ok(None),
            Some(value) => value
                .as_u64()
                .map(Some)
                .ok_or(format!("{key}: {field} must be a whole number")),
        }
    };
    let expires_at_ms = match (
        lifetime("expires_at_ms")?,
        lifetime("ttl_ms")?,
        lifetime("ttl_seconds")?,
    ) {
        (Some(at), _, _) => Some(at),
        (_, Some(ms), _) => Some(clock_ms.saturating_add(ms)),
        (_, _, Some(seconds)) => Some(clock_ms.saturating_add(seconds.saturating_mul(1000))),
        _ => None,
    };
    Ok(Entry {
        value: value_from_json(key, &fields["value"])?,
        expires_at_ms,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seeded(body: Value) -> Engine {
        let mut engine = Engine::default();
        engine.load(&body).unwrap();
        engine
    }

    #[test]
    fn a_key_lives_until_the_logical_clock_passes_its_deadline() {
        let mut engine =
            seeded(json!({ "keys": { "user:1": { "value": "ada", "ttl_seconds": 60 } } }));
        assert_eq!(engine.get("user:1"), Some(b"ada".to_vec()));
        engine.advance_ms(59_999);
        assert_eq!(engine.get("user:1"), Some(b"ada".to_vec()));
        // Deadlines are inclusive, exactly like Redis: at the deadline the key is gone.
        engine.advance_ms(1);
        assert_eq!(engine.get("user:1"), None);
        assert!(!engine.exists("user:1"));
    }

    #[test]
    fn ttl_distinguishes_missing_from_persistent() {
        let mut engine = seeded(
            json!({ "keys": { "plain": "v", "volatile": { "value": "v", "ttl_ms": 1500 } } }),
        );
        assert_eq!(engine.ttl_ms("gone"), None);
        assert_eq!(engine.ttl_ms("plain"), Some(None));
        assert_eq!(engine.ttl_ms("volatile"), Some(Some(1500)));
        engine.advance_ms(500);
        assert_eq!(engine.ttl_ms("volatile"), Some(Some(1000)));
    }

    #[test]
    fn set_clears_a_deadline_but_keep_ttl_preserves_it() {
        let mut engine = seeded(json!({ "keys": { "k": { "value": "a", "ttl_ms": 1000 } } }));
        engine.set_keep_ttl("k", b"b".to_vec());
        assert_eq!(engine.ttl_ms("k"), Some(Some(1000)));
        engine.set("k", b"c".to_vec(), None);
        assert_eq!(engine.ttl_ms("k"), Some(None));
    }

    #[test]
    fn expire_only_applies_to_a_live_key() {
        let mut engine = seeded(json!({ "keys": { "k": "v" } }));
        assert!(engine.expire("k", 1000));
        assert!(!engine.expire("missing", 1000));
        engine.advance_ms(1000);
        assert!(
            !engine.expire("k", 1000),
            "an expired key is not there to expire"
        );
    }

    #[test]
    fn incr_counts_from_zero_and_rejects_non_numeric_values() {
        let mut engine = Engine::default();
        assert_eq!(engine.incr_by("hits", 1), Ok(1));
        assert_eq!(engine.incr_by("hits", 41), Ok(42));
        engine.set("name", b"ada".to_vec(), None);
        assert!(engine.incr_by("name", 1).is_err());
        engine.set("big", i64::MAX.to_string().into_bytes(), None);
        assert!(engine.incr_by("big", 1).is_err());
    }

    #[test]
    fn incr_keeps_the_existing_deadline() {
        let mut engine = seeded(json!({ "keys": { "hits": { "value": 1, "ttl_ms": 500 } } }));
        assert_eq!(engine.incr_by("hits", 1), Ok(2));
        assert_eq!(engine.ttl_ms("hits"), Some(Some(500)));
    }

    #[test]
    fn take_and_put_restore_an_entry_untouched() {
        let mut engine = seeded(json!({ "keys": { "k": { "value": "fresh", "ttl_ms": 900 } } }));
        let entry = engine.take("k").unwrap();
        assert!(engine.get("k").is_none());
        engine.put("k", entry);
        assert_eq!(engine.get("k"), Some(b"fresh".to_vec()));
        assert_eq!(engine.ttl_ms("k"), Some(Some(900)));
    }

    #[test]
    fn snapshot_round_trips_through_load() {
        let mut engine = seeded(json!({
            "clock_ms": 5_000,
            "keys": { "a": "one", "b": { "value": "two", "ttl_seconds": 30 } }
        }));
        let snapshot = engine.snapshot();

        engine.advance_ms(100_000);
        engine.set("c", b"three".to_vec(), None);
        engine.load(&snapshot).unwrap();

        assert_eq!(engine.state()["clock_ms"], 5_000);
        assert_eq!(engine.get("a"), Some(b"one".to_vec()));
        assert_eq!(engine.ttl_ms("b"), Some(Some(30_000)));
        assert_eq!(engine.get("c"), None, "load replaces the keyspace");
    }

    #[test]
    fn non_utf8_values_survive_a_snapshot_round_trip() {
        let mut engine = Engine::default();
        engine.set("blob", vec![0xff, 0x00, 0xfe], None);
        let snapshot = engine.snapshot();
        engine.load(&snapshot).unwrap();
        assert_eq!(engine.get("blob"), Some(vec![0xff, 0x00, 0xfe]));
    }

    #[test]
    fn state_reports_remaining_ttl_and_hides_expired_keys() {
        let mut engine = seeded(json!({
            "keys": { "plain": "v", "volatile": { "value": "v", "ttl_ms": 1000 } }
        }));
        engine.advance_ms(400);
        assert_eq!(
            engine.state(),
            json!({
                "clock_ms": 400,
                "keys": { "plain": {"value": "v", "ttl_ms": null},
                          "volatile": {"value": "v", "ttl_ms": 600} }
            })
        );
        engine.advance_ms(600);
        assert_eq!(
            engine.state()["keys"],
            json!({ "plain": {"value": "v", "ttl_ms": null} })
        );
    }

    #[test]
    fn a_seeded_number_becomes_its_text_form_so_incr_can_read_it() {
        let mut engine = seeded(json!({ "keys": { "hits": 7 } }));
        assert_eq!(engine.get("hits"), Some(b"7".to_vec()));
        assert_eq!(engine.incr_by("hits", 1), Ok(8));
    }

    #[test]
    fn bad_seed_bodies_fail_loudly() {
        let rejected = [
            json!("not an object"),
            json!({ "kys": {} }),
            json!({ "keys": [] }),
            json!({ "clock_ms": -1 }),
            json!({ "keys": { "k": { "value": "v", "ttl_ms": 1, "ttl_seconds": 1 } } }),
            json!({ "keys": { "k": { "value": "v", "tt1_ms": 1 } } }),
            json!({ "keys": { "k": { "value": "v", "ttl_ms": "soon" } } }),
            json!({ "keys": { "k": true } }),
            json!({ "keys": { "k": [999] } }),
        ];
        for body in rejected {
            assert!(
                Engine::default().load(&body).is_err(),
                "must be rejected: {body}"
            );
        }
        // `emulator` is part of every seed body and must not trip the field check.
        assert!(Engine::default()
            .load(&json!({ "emulator": "cache", "keys": {} }))
            .is_ok());
    }
}
