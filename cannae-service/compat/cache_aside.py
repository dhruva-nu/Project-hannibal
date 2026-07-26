#!/usr/bin/env python3
"""Blessed-client compatibility suite: `redis-py`, unmodified, against the emulator.

Two things are being proved at once:

1. **Compatibility** — a real client library connects and operates without knowing
   it is not talking to Redis. Nothing here is emulator-aware; the only import is
   `redis`, and the connection is a plain `redis://host:port`.
2. **The cache-aside milestone lesson** (#134) — `get_user_profile()` is graded the
   way the harness grades it: from the op log, not from the return value.

Its Node twin, `cache_aside.mjs`, runs the same scenario through `ioredis`.
"""

import json
import os
import sys
import urllib.error
import urllib.request

import redis

CONTROL = os.environ.get("CANNAE_CONTROL", "http://127.0.0.1:9900")
HOST = os.environ.get("CANNAE_HOST", "127.0.0.1")
PORT = int(os.environ.get("CANNAE_PORT", "6379"))

# Client libraries chatter on connect (`CLIENT SETINFO`, `INFO`, `HELLO`). That is
# real traffic and the log records it faithfully; a grader cares about the data ops
# the student's own code issued, so it filters to these.
LESSON_OPS = {
    "GET", "MGET", "SET", "SETNX", "SETEX", "DEL",
    "EXISTS", "EXPIRE", "TTL", "INCR", "INCRBY",
}


def control(method, path, body=None):
    """Call the harness-only control plane. Never reachable from a student sandbox."""
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(
        f"{CONTROL}{path}", data=data, method=method,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request) as response:
            payload = response.read()
    except urllib.error.HTTPError as error:
        raise SystemExit(f"control {method} {path} failed: {error.code} {error.read().decode()}")
    return json.loads(payload) if payload else None


def lesson_ops():
    log = control("GET", "/log?emulator=cache")
    return [record["op"] for record in log if record["op"] in LESSON_OPS]


def fresh_cache(keys=None, faults=()):
    """Reset the emulator, seed it, arm any rules — *then* connect.

    Order matters and mirrors the lesson flow: `/reset` retires every live socket, so
    a client created before it would find its connection dropped. The harness always
    sets the scene before the student's code runs.
    """
    control("POST", "/reset")
    control("POST", "/seed", {"emulator": "cache", "keys": keys or {}})
    for rule in faults:
        control("POST", "/faults", {"emulator": "cache", **rule})
    return redis.Redis(host=HOST, port=PORT, decode_responses=True)


def expect(actual, wanted, what):
    if actual != wanted:
        raise SystemExit(f"FAIL {what}\n  expected: {wanted!r}\n  actual:   {actual!r}")
    print(f"  ok  {what}")


class BackingStore:
    """The store the cache sits in front of. Its read count is the whole point."""

    def __init__(self, rows):
        self.rows = rows
        self.reads = 0

    def read(self, user_id):
        self.reads += 1
        return self.rows.get(user_id)


def get_user_profile(cache, store, user_id):
    """The lesson's target implementation — plain cache-aside, no emulator awareness."""
    key = f"user:{user_id}"
    cached = cache.get(key)
    if cached is not None:
        return cached
    profile = store.read(user_id)
    if profile is None:
        return None
    cache.set(key, profile, ex=60)
    return profile


def smoke():
    """The command surface a caching lesson needs, driven through the real client."""
    cache = fresh_cache()
    expect(cache.ping(), True, "PING")
    expect(cache.set("a", "1"), True, "SET")
    expect(cache.get("a"), "1", "GET")
    expect(cache.exists("a", "b"), 1, "EXISTS")
    expect(cache.setnx("a", "2"), False, "SETNX on an existing key")
    expect(cache.get("a"), "1", "SETNX did not overwrite")
    expect(cache.incr("hits"), 1, "INCR")
    expect(cache.incrby("hits", 9), 10, "INCRBY")
    expect(cache.expire("a", 30), True, "EXPIRE")
    expect(cache.ttl("a"), 30, "TTL")
    expect(cache.mget("a", "missing", "hits"), ["1", None, "10"], "MGET")
    expect(cache.setex("s", 5, "v"), True, "SETEX")
    expect(cache.ttl("s"), 5, "TTL after SETEX")
    expect(cache.set("nx", "v", nx=True), True, "SET NX on a free key")
    expect(cache.set("nx", "w", nx=True), None, "SET NX on a taken key")
    expect(cache.set("nx", "w", xx=True), True, "SET XX on a taken key")
    expect(cache.delete("a", "hits"), 2, "DEL")
    expect(cache.get("a"), None, "GET after DEL is a miss")


def cache_aside():
    """The milestone lesson, graded from the op log."""
    cache = fresh_cache()
    store = BackingStore({"1": '{"name":"Ada"}'})

    expect(get_user_profile(cache, store, "1"), '{"name":"Ada"}', "first call returns the profile")
    expect(lesson_ops(), ["GET", "SET"], "the cache is read BEFORE the store, written AFTER the miss")
    expect(store.reads, 1, "the miss read the backing store once")

    expect(get_user_profile(cache, store, "1"), '{"name":"Ada"}', "second call returns the profile")
    expect(lesson_ops(), ["GET", "SET", "GET"], "a hit issues no SET")
    expect(store.reads, 1, "a hit does not touch the backing store")

    # Forced expiry — a scripted clock advance, not a 61-second sleep.
    control("POST", "/faults", {"emulator": "cache", "action": "advance_clock",
                                "params": {"seconds": 61}})
    expect(get_user_profile(cache, store, "1"), '{"name":"Ada"}', "fallback after expiry")
    expect(lesson_ops(), ["GET", "SET", "GET", "GET", "SET"], "an expired entry is repopulated")
    expect(store.reads, 2, "the expiry sent the student back to the store")


def forced_expiry_fault():
    """The same fallback, forced by a fault rule targeting one key."""
    cache = fresh_cache(
        keys={"user:1": "ada", "user:2": "grace"},
        faults=[{"action": "expire_key",
                 "after": {"op_matches": "read", "count": 1},
                 "params": {"key": "user:1"}}],
    )
    expect(cache.get("user:2"), "grace", "an unrelated key does not consume the rule")
    expect(cache.get("user:1"), None, "the fault turns the read into a miss")
    expect(cache.get("user:1"), None, "and the key is really gone")


def error_handling():
    """A student's mistake must raise the same exception a real Redis would."""
    cache = fresh_cache()
    try:
        cache.execute_command("FLUSHALL")
    except redis.ResponseError as error:
        expect(str(error), "unknown command 'FLUSHALL'", "an unknown command raises ResponseError")
    else:
        raise SystemExit("FAIL an unknown command must raise")

    cache.set("name", "ada")
    try:
        cache.incr("name")
    except redis.ResponseError as error:
        expect(str(error), "value is not an integer or out of range", "INCR on text raises")
    else:
        raise SystemExit("FAIL INCR on a non-numeric value must raise")

    # The connection survives both errors.
    expect(cache.ping(), True, "the connection is still usable after errors")


def main():
    print(f"redis-py {redis.__version__} → redis://{HOST}:{PORT}")
    for stage in (smoke, cache_aside, forced_expiry_fault, error_handling):
        print(f"{stage.__name__}:")
        stage()

    print("redis-py compatibility suite passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
