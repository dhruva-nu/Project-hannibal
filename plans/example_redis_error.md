# Example: `example_redis_error.md` — the emulator teaching **cache is unreliable infra**

Companion to [infra-emulators.md](./infra-emulators.md) (Phase 1, Redis RESP2) and
[current-problem.md](../current-problem.md). Sibling of [example_rollback.md](./example_rollback.md);
same shape, different failure mode.

Concept taught: *the cache is best-effort infrastructure, not a source of truth*. When Redis
errors or a key expires mid-request, correct code **falls through to the database** — it neither
crashes nor serves corrupt data. The student learns it by watching their own naive `get_user_profile`
turn a Redis blip into a full-blown app outage, then fixing it. The error and the expiry are
deterministic because the thing on port 6379 is the cache emulator, not real Redis.

---

## 1. What the student sees

`cache:6379` speaks RESP2. The student uses **real `redis-py`** — nothing is mocked, nothing is
imported differently. Their connection string is an ordinary env var
(`REDIS_URL=redis://cache:6379`), and the profile source of truth lives in the SQL DB behind
`DATABASE_URL` (any wire-compatible client).

### Student template (what they fill in)

```python
import json
import redis
from sqlalchemy.orm import Session

cache = redis.from_url(os.environ["REDIS_URL"])   # → cache:6379, the emulator


def get_user_profile(session: Session, user_id: int) -> dict:
    """Cache-aside: check Redis, on miss read the DB and populate Redis."""
    ...  # student implements this
```

### The two solutions the lesson contrasts

**Naive (passes the happy path, an outage in the cache becomes an outage in the app):**

```python
def get_user_profile(session, user_id):
    key = f"user:{user_id}"

    cached = cache.get(key)                     # ← if Redis errors here, the whole request throws
    if cached is not None:
        return json.loads(cached)

    profile = load_profile_from_db(session, user_id)
    cache.set(key, json.dumps(profile))         # ← a failed SET here also kills the request
    return profile
```

**Correct (cache is best-effort — any Redis error falls through to the DB):**

```python
def get_user_profile(session, user_id):
    key = f"user:{user_id}"

    try:
        cached = cache.get(key)
        if cached is not None:
            return json.loads(cached)
    except redis.RedisError:
        log.warning("cache read failed, falling back to DB", extra={"key": key})

    profile = load_profile_from_db(session, user_id)   # source of truth, always reachable

    try:
        cache.set(key, json.dumps(profile))            # repopulate — best effort
    except redis.RedisError:
        log.warning("cache write failed, serving from DB", extra={"key": key})

    return profile
```

The lesson's whole point: **both pass `test_get_profile_cached`. Only the correct one passes
`test_cache_errors` and `test_key_expired_midflight`.** The fault cases are what separate "it
works when Redis is up" from "it degrades gracefully when Redis isn't".

---

## 2. What the lesson author writes

### `infra_init` — declare the infra, seed the key and its backing row

```python
def infra_init():
    cache = setup_cache()                       # spins the cache emulator on :6379, control API on :9900
    db = setup_db()                             # the source of truth behind the cache
    db.add_table(UserProfile)
    db.seed_row(UserProfile(id=1, name="Alice", tier="gold"))

    cache.seed("user:1", json.dumps({"id": 1, "name": "Alice", "tier": "gold"}))
    return cache, db
```

`setup_cache()` returns a **control handle** — a thin Python wrapper over the emulator's control
API (`/seed`, `/reset`, `/log`, `/faults`, `/state`). It is **not** the student's `redis-py`
client; it talks to the emulator over the harness-only network, which the student container
can't reach (Phase 0b, non-negotiable — students must not reset their own graded state).

Two distinct objects, never confused:

| Object | Whose | Speaks | Used for |
|---|---|---|---|
| `cache` (redis-py) | student's | RESP2 on :6379 | the code under test |
| `cache` (handle) | harness's | control API on :9900 | seed, fault, assert |

*(In the tests the harness handle is named `ctl` to keep them apart.)*

### The tests

```python
def test_get_profile_cached(client, session, ctl):
    # Warm hit: the seeded key is present, so no DB read at all.
    profile = get_user_profile(session, 1)

    assert profile["name"] == "Alice"
    ctl.oplog.assert_order("GET")                 # served from cache
    assert ctl.state.db_reads() == 0              # DB never touched


def test_cache_errors(client, session, ctl):
    # Arm the fault: the FIRST GET returns a RESP error → redis-py raises RedisError.
    ctl.fail(action="inject_error", after="GET", count=1)

    # Correct solution swallows the error and falls through to the DB.
    # Naive solution lets RedisError escape and the request throws.
    profile = get_user_profile(session, 1)

    assert profile["name"] == "Alice"             # still correct, served from the DB
    assert ctl.state.db_reads() == 1              # DB was hit exactly once on the error path
    ctl.oplog.assert_order("GET", "SET")          # tried cache first, then repopulated after fallback


def test_key_expired_midflight(client, session, ctl):
    # Deterministic expiry: the key is gone the next time the student reads it → a miss.
    ctl.fail(action="expire_key", key="user:1", on="next_read")

    profile = get_user_profile(session, 1)

    assert profile["name"] == "Alice"             # miss → DB fallback, still correct
    assert ctl.state.db_reads() == 1              # fetched from source of truth
    assert ctl.state.exists("user:1")             # repopulated: the key is back
    ctl.oplog.assert_order("GET", "SET")          # miss, then re-cached
```

---

## 3. The open question, decided: `ctl.fail(...)` arguments

Parallel to `db.fail(...)` in the rollback doc. `ctl.fail(...)` installs one declarative fault
rule via `POST /faults` and returns immediately — it arms the emulator; the fault fires later
when the student's code trips the trigger. Same argument shape as the SQL emulator's: **action +
trigger + key/count**.

```python
ctl.fail(
    action="inject_error",   # WHAT the emulator does when the trigger hits
    after="GET",             # trigger: fire on a command whose type matches this
    count=1,                 # ...on the Nth matching command (1 = the first). default 1
    key=None,                # scope to one key (for key-targeted actions like expire_key)
    on=None,                 # key-relative trigger: "next_read" | "next_write"
    times=1,                 # how many times this rule may fire before it retires. default 1
    resp_error="ERR backend unavailable",   # only for action="inject_error": the RESP error string
)
```

Field by field:

- **`action`** *(required)* — the fault behavior. For the cache emulator:
  - `"inject_error"` — return a RESP `-ERR …` frame (or drop the connection) so `redis-py`
    raises `ResponseError`/`ConnectionError` at that exact command (this lesson, test 1).
  - `"expire_key"` — make a specific key expire deterministically (this lesson, test 2). Mirrors
    plan §3 *expire-on-next-read*.
  - `"serve_stale"` — return the pre-expiry value once before honoring expiry (plan §3
    *serve-stale-once*), for stale-read lessons.
  - `"advance_clock"` — advance the emulator's **logical clock** by `seconds=N` so TTLs expire
    with no `sleep` in the test (plan §3). The alternative to `expire_key` when a lesson is
    specifically about `EXPIRE`/`TTL` semantics rather than a forced mid-request miss. Unlike
    the others this is an **immediate** action — it applies at install time, no trigger to arm.
  - `"delay"` — stall the response `ms=N`, for cache-timeout lessons.
- **`after`** — the trigger command type: `"GET"`, `"SET"`, `"DEL"`, `"INCR"`, `"EXPIRE"`, … or
  a cache-registered op **class**: `"read"` (= `GET|MGET`), `"write"` (= `SET|DEL|…`). Matched
  against the emulator's op log as each RESP frame is processed. `connect`/`disconnect` are
  themselves logged ops, so `after="connect"` fires the moment `redis-py` connects — "the cache
  is down from the start" is one line.
- **`count`** — fire on the *Nth* occurrence of `after`, counted from the moment the rule is
  armed. `count=1` + `after="GET"` = "the first cache read errors" — the exact point real
  Redis can't be made to fail deterministically.
- **`key`** — scope a key-targeted action (`expire_key`, `serve_stale`) to one key. Ignored by
  command-triggered actions like `inject_error`. On the wire it rides in the `params` bag; the
  cache emulator's trigger-scoping hook (`matches`) narrows the rule to ops touching that key.
- **`on`** — key-relative trigger sugar for key-targeted actions: `"next_read"` (fire when the
  key is next `GET`/`MGET`-touched) or `"next_write"`. Pure convenience on the handle side —
  it expands to the uniform contract: `on="next_read"` ⇒ `after={"op_matches": "read",
  "count": 1}` + the key in `params`. One trigger mechanism underneath, not two.
- **`times`** — how many times the rule may fire before it retires. `times=1` (default) = one-shot.
  Set higher for "the cache is down for the next two reads" scenarios.
- **`resp_error`** — only meaningful with `action="inject_error"`; the RESP error string returned
  so the student's client raises the same exception it would in production. Omit it and the
  emulator drops the connection instead (→ `ConnectionError`).

Why these and not fewer: `action` + `after` + `count` are the same irreducible core as the SQL
doc — *what* happens, *on which kind of command*, *at which occurrence*. `key`/`on` exist because
the cache has key-scoped faults the SQL emulator doesn't (deterministic expiry needs to name a
key and a moment). `times` and `resp_error` each earn their place from a concrete lesson
(cache-down-for-N-reads, teach-the-real-exception), per the plan's "feature requests must cite a
lesson" rule.

The raw wire these calls produce:

```json
{"emulator": "cache", "action": "inject_error",
 "after": {"op_matches": "GET", "count": 1}, "times": 1,
 "params": {"resp_error": "ERR backend unavailable"}}

{"emulator": "cache", "action": "expire_key",
 "after": {"op_matches": "read", "count": 1},
 "params": {"key": "user:1"}}
```

(Protocol extras — `resp_error`, `key` — travel in the `params` bag the generic fault engine
never interprets; it matches the trigger and hands `params` to the cache emulator. See plan
§1, *the kit/protocol seam*.)

---

## 4. How grading actually reads the result

Two independent signals, both from the emulator — neither trusts the student's return value:

1. **State assertion** (`GET /state`) — did the fallback and repopulate actually happen?
   `ctl.state.db_reads() == 1` proves the source of truth was consulted exactly once on the error
   path (not zero → didn't fall through; not twice → didn't repopulate and re-missed).
   `ctl.state.exists("user:1")` proves the key came back after the miss. The naive solution never
   reaches these asserts — it throws inside `get_user_profile` first.
2. **Op-log assertion** (`GET /log`) — did they do cache-aside *for the right reason*? Because the
   emulator sees **every RESP frame**, "did they check the cache before the DB?" is a **log
   query**, not a heuristic:

   ```python
   ctl.oplog.assert_order("GET", "SET")   # attempted the cache first, then repopulated after the miss/error
   ```

   The correct solution's log shows a `GET` (the attempt) followed by a `SET` (the repopulate on
   the fallback path). A student who skipped the cache entirely and went straight to the DB has
   **no `GET`** in the log — caught even though their return value is correct. A student who read
   the cache but never repopulated has a `GET` and **no `SET`** — caught even though this one
   request looks fine. The grader can therefore tell the student *precisely* what went wrong:

   > "Redis returned an error on your first `GET` and your request crashed with it. A cache is
   > best-effort infrastructure — when it's unavailable, catch the error and read from the
   > database instead. Your users shouldn't see an outage because the cache hiccuped."

That teachable message — not a stack trace — is what `get_user_profile` grading surfaces (plan §7).

---

## 5. Fixtures this example assumes (for the harness authors)

```python
@pytest.fixture
def ctl():
    cache, db = infra_init()          # starts emulators, seeds key + backing row
    yield ControlHandles(cache, db)
    cache.reset()                     # POST /reset restores the seeded snapshot between cases
    db.reset()

@pytest.fixture
def session(ctl):
    engine = create_engine(os.environ["DATABASE_URL"])   # the source of truth
    with Session(engine) as s:
        yield s
```

`reset()` between tests is why the three cases don't leak state into each other — the same
snapshot/reset path the plan lists in the control API table. Each test re-arms its own fault on a
clean, seeded emulator.
