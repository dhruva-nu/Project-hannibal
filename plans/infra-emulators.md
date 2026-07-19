# Plan: Protocol-level infrastructure emulators (SQL, NoSQL, queue, cache)

**Goal:** students write real code with real client libraries (any language) against what they
believe is Postgres / MongoDB / RabbitMQ / Redis — but is actually a set of deterministic,
instrumented emulators we control. See [current-problem.md](../current-problem.md) for the
full rationale. This plan covers the first goal: **SQL DB, NoSQL DB, queue, and cache**.

---

## 1. What we're building

A new top-level service, sibling of `rce-service`, written in **Rust** and shipped as a
**single statically linked binary** (musl target):

```
emu-service/                # Cargo workspace
  Cargo.toml
  Dockerfile                # multi-stage: build → FROM scratch + the binary
  crates/
    emu-core/               # shared kit (Phase 0)
      src/server.rs         #   tokio TCP listeners + connection lifecycle
      src/oplog.rs          #   structured operation log (the grading source of truth)
      src/faults.rs         #   fault-injection rule engine
      src/control.rs        #   HTTP control API (seed / reset / log / faults / state)
      src/registry.rs       #   which emulators to start for a given run config
    emu-echo/               # Phase 0 — trivial proving emulator built ON the kit
    emu-cache/              # Phase 1 — Redis (RESP2)
    emu-sql/                # Phase 2 — Postgres wire protocol v3
    emu-nosql/              # Phase 3 — MongoDB OP_MSG
    emu-queue/              # Phase 4 — AMQP 0-9-1
    emu/                    # the binary crate: config parsing + starts declared emulators
  tests/
    compat/                 # REAL client libraries against each emulator (CI matrix)
```

**Language: Rust.** Decided over Python for one property that changes the deployment story:
the output is one dependency-free static binary, injectable anywhere — a `FROM scratch`
image a few MB in size, or a read-only bind-mount into any existing container (the same
mechanism `rce-service` already uses for package caches). Startup is milliseconds, so
per-test-run spawn cost is negligible. Side benefits: the protocol ecosystem is strong
(`tokio` for async IO, `pgwire` for the Postgres protocol, `bson` for Phase 3,
`rusqlite` for the embedded SQL engine), and memory-safe binary parsing is exactly Rust's
home turf. Cost we accept: the team writes more Python day-to-day than Rust, and compile
times enter CI.

**One process, many personalities.** The `emu` binary starts only the listeners a lesson
declares (`--infra postgres,redis` or config file), each on its standard port, plus the
control API on `:9900`. One instance per test run — cheap, disposable.

**Distribution.** Primary: a `FROM scratch` (or distroless) image containing just the
binary, run as its own container on the per-run network (Phase 0b). The binary being
self-contained also keeps a fallback open — running it as a sidecar process inside another
container via bind-mount — but v1 uses the separate-container model: it keeps the student
process unable to inspect, kill, or ptrace the emulator, which grading integrity requires.

### The control API (what the test harness talks to)

| Endpoint | Purpose |
|---|---|
| `POST /seed` | Load initial state (tables + rows, keys, queues) from lesson fixtures — **and snapshot it as the reset baseline** |
| `POST /reset` | Restore the seeded snapshot **and clear the op log, fault rules, and conn/ordinal counters** — a fresh test case, deterministic from zero |
| `GET /log` | Structured op log: every protocol-level operation, ordered, per connection |
| `POST /faults` | Install a fault rule (validated at install — see contract below) |
| `DELETE /faults` | Clear all installed rules |
| `GET /state` | Dump engine state for assertions (balances, queue depths, key TTLs) |

**Fault rules** are declarative and share **one contract across all four emulators** (locked
in Phase 0, #132):

```json
{"emulator": "sql",   "action": "kill_connection",
 "after": {"op_matches": "UPDATE", "count": 1}, "times": 1, "conn": "any"}

{"emulator": "queue", "action": "drop_before_ack",
 "after": {"op_matches": "deliver", "count": 1}, "times": 1}

{"emulator": "cache", "action": "expire_key",
 "after": {"op_matches": "read", "count": 1}, "params": {"key": "user:1"}}
```

This is the product's edge: deterministic mid-transaction crashes, duplicate deliveries, and
stale-cache scenarios that are impossible to script against real infrastructure.

### How a fault travels: armed on the control plane, fired on the data plane

`db.fail(...)` never touches the student's connection. It only **arms** a rule — writes it
into the fault engine and returns immediately. The rule sits dormant until the student's own
traffic flows through the emulator and trips the trigger. This works because both planes are
**one process** sharing one fault engine:

```
                 emu-service (ONE binary, its own container per test run)
                 ┌───────────────────────────────────────────────────────────┐
  harness ─────▶ │ :9900  control plane      POST /faults ─▶ engine.install  │
 (harness net)   │                                              │            │
                 │                                    shared FaultEngine     │
                 │                                    (+ OpLog, snapshots)   │
                 │                                              │            │
  student ─────▶ │ :5432/:6379/:5672  data plane   per op ─▶ engine.evaluate │
 (sandbox net)   └───────────────────────────────────────────────────────────┘
```

Full trace of `db.fail(action="kill_connection", after="UPDATE", count=1)`:

1. Harness → `POST :9900/faults` → rule validated + installed, HTTP 200. Nothing fires. **Armed.**
2. Later, the student's psycopg2 sends the debit `UPDATE` to `:5432`.
3. The per-connection loop decodes the frame → logs the op → asks the engine. First `UPDATE`
   since arming → match → the kit executes the generic action: socket dropped mid-flight.
4. The student's driver raises the same `OperationalError` a real crash would produce; the
   op log shows the fatal `UPDATE`, annotated with the fault that fired on it.

Every data-plane op follows the same pipeline — this ordering is normative:

```
decode → oplog.append(op) → faults.evaluate(op) → execute (or fault action instead) → respond
```

Log-before-evaluate matters: the op that triggers a kill or an injected error must appear in
the log the grader reads.

### The fault-rule contract

| Field | Meaning |
|---|---|
| `emulator` | which engine the rule targets (`sql`, `cache`, `queue`, `nosql`, `echo`) |
| `action` | what fires — a **generic** action (`kill_connection`, `inject_error`, `delay`) or a **protocol-registered** one (`drop_before_ack`, `expire_key`, `serve_stale`, `redeliver`, …) |
| `after.op_matches` | the trigger: an op type as it appears in the log (`UPDATE`, `deliver`, `GET`), or a protocol-registered op **class** (the cache registers `read` = `GET\|MGET`). `connect` and `disconnect` are first-class logged ops emitted by the kit, so "fail the moment they connect" is just `after="connect"` — no special case |
| `after.count` | fire on the Nth match |
| `times` | fires allowed before the rule retires (default 1). A rule fires on the `count`-th match and on every subsequent match until `times` is exhausted — so `times=2` naturally covers "the retry / the redelivery also fails" |
| `conn` | connection scope: `"any"` (default), `"next"` (only the connection opened next after arming), or a `conn_id` from `/log` |
| `params` | opaque protocol-specific bag (`{"sqlstate": "40P01"}`, `{"key": "user:1"}`, `{"ms": 200}`). The generic engine never interprets it — it hands it to the owning emulator |

Semantics that make this safe and deterministic:

- **Counting starts at arm time.** Ops that happened before `POST /faults` returned can never
  trip the rule — the harness can seed over the wire, then arm, without racing itself. (This
  is why `conn="any"` is a safe default: in the lesson flow the harness arms *after* its own
  traffic and *before* the student's code runs.)
- **Triggered vs immediate.** Most actions are *triggered* (armed, fire on a matching op). A
  protocol may also register **immediate** actions (`advance_clock`, `pause_consumers`) that
  apply at install time and have no trigger.
- **First match wins.** Rules are evaluated in install order; at most one rule fires per op.
- **Fail loudly.** `POST /faults` validates at install time: unknown emulator, unknown
  action, or params the action doesn't accept → 4xx immediately — never a silently-dead rule.

### The kit/protocol seam

The kit owns **trigger matching**; each protocol owns **action execution**:

```rust
// emu-core — generic, written once (Phase 0)
struct FaultRule { emulator, after: Option<Trigger>, times, conn, action: String, params: Value }

enum Outcome { Continue, CloseConnection, ReplaceResponse(Vec<u8>) }

// each emulator implements (echo now; Redis/PG/Mongo/AMQP in Phases 1–4)
trait Emulator {
    fn decode(..) -> Op;                            // wire frames → typed ops
    fn execute(.., op) -> Vec<u8>;                  // apply to engine, produce reply bytes
    fn apply_fault(action, params, ..) -> Outcome;  // protocol-specific actions
    fn encode_error(params) -> Vec<u8>;             // inject_error's error frame (SQLSTATE, -ERR, …)
    fn matches(op, params) -> bool;                 // extra trigger scoping (key-targeted faults)
    fn seed / snapshot / restore / state(..);       // control-plane hooks
}
```

Worked examples of the seam:

- `inject_error` + `params.sqlstate="40P01"` — the kit matches the trigger; the SQL
  emulator's `encode_error` builds a real Postgres `ErrorResponse` (+ `ReadyForQuery('E')`);
  the op is logged but **not executed**.
- `expire_key` + `params.key="user:1"` — the cache's `matches` narrows the generic `read`
  trigger to reads of that one key.
- `drop_before_ack` — the queue's `apply_fault` returns `CloseConnection` after the
  `Basic.Deliver` frame but before any ack, and its engine requeues the unacked message
  with `redelivered=1`.

Phases 1–4 never re-touch how a fault travels from `:9900` to the student's socket — they
only add `decode` / `execute` / `apply_fault` / `encode_error` / `matches`.

---

## 2. Phase 0 — Core kit + sandbox networking

### 0a. Emulator kit + control plane (`crates/emu-core/` + `emu-echo/` — issue #132)

**Scope decision (recorded):** #132 ships the **Rust binary only** — no Python control
handle yet. The echo e2e test drives the control API over raw HTTP and the data plane over
raw TCP, in Rust (`tests/echo_e2e.rs`). The wire contracts (`/faults` rule shape, `/log`
record shape, `/state`) are designed to match the `example_*.md` docs exactly, so the later
Python handle (grading track, #138) is a thin wrapper with nothing to renegotiate.

- tokio TCP server harness: per-connection task running the normative pipeline (§1). The
  **kit itself emits `connect` / `disconnect` ops** into the log — they're fault triggers
  (`after="connect"` = "DB is down" lessons) and grading signals (reconnect visibility).
- Op log: append-only `{conn_id, seq, ordinal, op, args, fault?}` — logical ordinal
  counter, no wall clock. `fault` names the action if a rule fired on that op. `conn_id`
  assigned in accept order; `seq` per connection.
- Fault engine: the contract in §1 — generic actions (`kill_connection`, `inject_error`,
  `delay`) in the kit; registration hooks for protocol actions, op classes, `matches`
  scoping, and immediate actions.
- Control API (`axum`) on a **configurable bind address** (`--control-bind <ip>`, default
  `0.0.0.0:9900` for local dev). This flag is load-bearing for isolation: a container on
  two Docker networks has two interfaces, and binding `0.0.0.0` would expose `:9900` on the
  sandbox network — 0b passes the harness-network IP so the control plane physically isn't
  listening where the student can route.
- Echo emulator (`crates/emu-echo`): line-framed; `seed` sets a prefix, `execute` echoes
  `prefix+line` and counts, `state` returns `{echo_count, prefix}`, `encode_error` →
  `-ERR <msg>\n`. Deliberately its own crate — proves the kit is extensible from outside
  `emu-core`, exactly how Phases 1–4 will plug in.
- Release build target `x86_64-unknown-linux-musl`; CI asserts the binary is fully static
  (`ldd` reports no dynamic deps) **and boots the `FROM scratch` image** — this property is
  the deployment story, so it's a test.

**Definition of done (0a / #132):** in Rust integration tests — a raw TCP client connects
to echo; the harness seeds a prefix over HTTP; the client sends lines and gets prefixed
echoes; a `kill_connection` rule (`after={op_matches:"ECHO",count:K}`) drops the socket at
exactly the Kth line; `/log` shows the K ops and is **byte-identical across two runs**;
`/state` reflects the count; `/reset` restores the baseline and clears log + rules. Plus an
`inject_error` case (echo returns `-ERR`) to prove the protocol-action seam, and an
`after="connect"` case to prove connect ops are triggers. No sandbox, no Docker networking —
that's 0b.

### 0b. Sandbox networking (change to `rce-service` — issue #133)

Today the student container runs with `network_mode="none"`
(`rce-service/rce_service/docker.py:75`). New model for lessons that declare infra:

1. Per-execution Docker network `emu-<exec_id>` created with **`internal=True`** — no
   internet, nothing else reachable. Lessons without infra keep `network_mode="none"`
   unchanged.
2. `emu-service` container attaches to it; student container attaches instead of `none`.
3. Student gets ordinary env vars: `DATABASE_URL=postgresql://student:student@db:5432/app`,
   `REDIS_URL=redis://cache:6379`, `MONGO_URL=mongodb://db:27017/app`,
   `AMQP_URL=amqp://guest:guest@queue:5672/` — aliases via network aliases on the emulator
   container.
4. The control API is **not** reachable from the student container: the emulator container
   attaches to a second, harness-only network with a **static IP** (Docker `ipv4_address`),
   and `rce-service` starts the binary with `--control-bind <that ip>` — so `:9900` is
   physically not listening on any interface the student can route to. Students must not be
   able to reset their own graded state.
5. Teardown removes container + network with the existing cleanup path.

Security review checklist for this step: `internal=True` verified (no egress), no inter-run
network reuse, control port absent from the sandbox-network interface (probe from a student
container in CI), emulator container itself runs unprivileged with the same hardening flags
as the sandbox.

**Definition of done (0b / #133):** the echo emulator from 0a runs on a per-run network;
student code in the sandbox connects to it by hostname; the harness seeds it, reads its op
log, and a `kill_connection` fault rule fires — while a probe from the student container
proves `:9900` is unreachable. No real protocol yet.

---

## 3. Phase 1 — Cache: Redis (RESP2)

Smallest protocol; proves the whole model end-to-end.

- **Protocol:** RESP2 framing (`*`/`$`/`+`/`-`/`:` — an afternoon of parser). Inline
  commands not needed.
- **Commands:** `GET SET DEL EXISTS EXPIRE TTL INCR INCRBY SETNX SETEX MGET PING SELECT
  HELLO` (reply with an error to `HELLO` v3 so clients fall back to RESP2, or implement the
  RESP3 map — decide during compat testing).
- **Engine:** dict + TTL bookkeeping driven by a logical clock the harness can advance
  (`POST /faults {"action": "advance_clock", "seconds": 61}`) — deterministic expiry, no
  sleeps in tests.
- **Faults:** expire-on-next-read, serve-stale-once, kill_connection, inject latency.
- **Compat matrix (CI):** `redis-py`, `ioredis` (Node). Each runs a scripted smoke suite
  against the emulator.

**Definition of done:** the milestone lesson from current-problem.md — student implements
cache-aside `get_user_profile()` in Python *or* JS; harness grades via op-log assertion
("GET before SQL", "SET after miss") and a forced-expiry scenario.

---

## 4. Phase 2 — SQL: Postgres wire protocol v3

- **Protocol:** startup + trust auth (`AuthenticationOk`), `ParameterStatus`,
  `ReadyForQuery` with correct `I`/`T`/`E` transaction status; **simple query** (`Q`) first,
  then **extended query** (`Parse`/`Bind`/`Describe`/`Execute`/`Sync`) — required for JDBC
  and psycopg3. Reject `SSLRequest` with `N` (plaintext) and verify clients accept that.
- **Engine decision — do not write a SQL engine.** Embed **SQLite in-memory behind the
  Postgres wire face** (`rusqlite`, compiled into the static binary — SQLite links
  statically for free). The student never sees SQLite (constraint 3 in current-problem.md is
  about what the student touches, not what's behind the protocol). Translation layer handles
  the lesson SQL subset: types (`NUMERIC`, `SERIAL` → SQLite equivalents), `RETURNING`
  (SQLite ≥3.35 supports it), `BEGIN/COMMIT/ROLLBACK` mapped one-to-one, type OIDs in
  `RowDescription` derived from a per-lesson schema manifest.
- **Catalog probes:** stub the fixed set ORMs fire on connect — `SELECT version()`,
  `current_schema()`, `pg_catalog.pg_type` lookups, `SET` statements (accept + ignore).
  Grow this stub list from compat-test failures, not speculation.
- **Faults:** `kill_connection after N statements`, `kill inside transaction`,
  `inject_error` (serialization failure / deadlock SQLSTATE `40001`/`40P01` to teach
  retries), per-statement delay.
- **Transaction tracking:** the engine mirrors SQLite's txn state to emit correct
  `ReadyForQuery` status bytes — this is also the grading signal ("was `BEGIN` sent before
  the first `UPDATE`").
- **Compat matrix:** `psycopg2`, `SQLAlchemy` (on psycopg2), `node-postgres`. Stretch: JDBC
  (forces extended-protocol correctness).

**Definition of done:** the banking lesson — `transfer_money()` graded by (a) happy path,
(b) kill-between-debit-and-credit fault → assert via `GET /state` that money is neither
created nor destroyed, (c) op-log assertion that a transaction wrapped both writes.

---

## 5. Phase 3 — NoSQL: MongoDB (OP_MSG)

- **Protocol:** message header (length, requestID, responseTo, opCode) + `OP_MSG` (opcode
  2013) section parsing. Modern drivers are OP_MSG-only — no legacy opcodes needed.
  BSON via the Rust `bson` crate (maintained by MongoDB) — zero parser work.
- **Handshake:** answer `hello` / `isMaster` (standalone, `maxWireVersion` pinned to a
  modern-but-fixed value), `ping`, `buildInfo`, `getParameter`. Drivers run this on connect
  and periodically (heartbeats) — must be solid.
- **Commands:** `insert`, `find` (filter subset: equality, `$gt/$lt/$in`, sort, limit),
  `update` (`$set`, `$inc`), `delete`, `count`, `getMore`/cursors (small result sets → can
  return everything in `firstBatch` initially and add real cursors only if a lesson needs
  them).
- **Engine:** dicts of collections; documents are just the parsed BSON dicts.
- **Faults:** kill mid-`insert` batch, inject `writeConcernError`, duplicate-key error on
  demand — teaches why "NoSQL has no transactions" lessons matter.
- **Compat matrix:** `pymongo`, `mongoose` (Node).

**Definition of done:** a lesson where the student implements a document-store operation
(e.g. denormalized write to two collections) and the harness proves the partial-failure
anomaly by killing between the two inserts.

---

## 6. Phase 4 — Queue: AMQP 0-9-1 (RabbitMQ)

The hardest and last — most stateful protocol, and the payoff (redelivery semantics) depends
on the state machine being right.

- **Protocol:** `AMQP\x00\x00\x09\x01` greeting; frame layer (type/channel/size/payload/
  `0xCE`); field-table binary encoding (the one fiddly parser); method dispatch by
  (class-id, method-id).
- **Methods (subset):** `Connection.Start/Tune/Open` (+ PLAIN auth accepted verbatim),
  `Channel.Open/Close`, `Queue.Declare`, `Basic.Publish` (+ content header/body frame
  reassembly), `Basic.Consume`, `Basic.Deliver` (server-push), `Basic.Ack/Nack/Reject`,
  `Basic.Qos` (prefetch), `Basic.Get` (polling consumers). Exchanges: default exchange
  only at first; `Exchange.Declare` + direct/fanout when a lesson teaches routing.
- **Engine state:** queues (deques), per-channel delivery-tag counters, unacked map,
  consumer registry. On connection drop: requeue unacked with `redelivered=1` — that IS the
  at-least-once lesson.
- **Faults:** force-redeliver (duplicate delivery), drop connection pre-ack, delay delivery,
  reorder two messages.
- **Compat matrix:** `pika` (Python), `amqplib` (Node).

**Decision recorded:** we considered "real RabbitMQ + fault-injecting proxy" (RabbitMQ is a
single lightweight process). Rejected for v1 to keep one architecture, one control API, and
full determinism — revisit only if AMQP compat testing blows past its budget.

**Definition of done:** idempotent-consumer lesson — student's consumer receives the same
payment message twice (scripted redelivery); grading asserts the account was charged once.

---

## 7. Grading integration (parallel track once Phase 1 lands)

- Lesson test cases become **scenario scripts**: `seed → run student code → (faults fire) →
  assert on /state + /log`.
- Ship a small assertion helper for lesson authors, e.g.
  `oplog.assert_order("BEGIN", "UPDATE", "UPDATE", "COMMIT")`,
  `state.balance("user_a") == 900`.
- Wire into the existing rce-service result contract (`contracts.py` / `result.py`) so a
  fault-scenario failure surfaces to the student as a named test case with a teachable
  message ("your transfer lost ₹100 when the DB crashed mid-transfer"), not a stack trace.

---

## 8. Testing strategy

- **Unit:** framing round-trips, engine semantics, fault-rule matching. 100% coverage per
  repo standard.
- **Compat (the tests that matter):** CI job per emulator running *real client libraries* in
  a container against the emulator — the blessed-library matrix above is the support
  contract. A library outside the matrix failing is a backlog item, not a bug.
- **Determinism check:** run every scenario twice, byte-compare op logs. Scope of the
  guarantee, stated honestly: `(conn_id, seq)` ordering within a connection is always
  reproducible, so single-connection scenarios (most lessons) are **globally
  byte-identical**. Scenarios with concurrent student connections (e.g. the deadlock
  lesson) may interleave differently across runs — grading for those asserts on
  per-connection order or `/state`, never on global interleaving.

---

## 9. Build order & rough sizing

| Phase | Issue | Item | Size | Depends on |
|---|---|---|---|---|
| 0 | #132 | Core kit + control API + echo | S | — |
| 0b | #133 | Sandbox networking in rce-service | S–M (security-sensitive) | 0 (needs the binary) |
| 1 | #134 | Redis/RESP | S | 0 |
| 2 | #135 | Postgres wire + SQLite engine | L (largest: extended protocol + catalog stubs) | 0 |
| 3 | #136 | Mongo OP_MSG | M (BSON is free; handshake is the work) | 0 |
| 4 | #137 | AMQP 0-9-1 | M–L (state machine + field tables) | 0 |
| — | #138 | Grading integration | M, incremental | 1 |

Phases 2, 3, 4 are independent of each other and parallelizable after Phase 1 validates the
kit. Ship value after every phase: Phase 1 alone unlocks all caching lessons.

## 10. Out of scope (v1)

Kafka; SQL beyond the lesson subset (joins beyond inner, CTEs, window functions); Mongo
aggregation pipelines & multi-doc transactions; AMQP topic exchanges/tx; TLS anywhere;
real auth (accept whatever credentials the URL carries); replication/clustering anything;
performance-realistic latencies (logical clock only).

## 11. Risks

1. **Catalog/handshake probes** (ORMs, driver heartbeats) are the top compat risk for
   Postgres and Mongo both. Mitigation: compat matrix in CI from day one of each phase;
   grow stubs from real failures.
2. **SQLite-behind-pg semantic drift** (type coercion, error codes). Acceptable for
   concept-teaching; document per-lesson SQL subset; emit Postgres-shaped SQLSTATEs.
3. **Scope creep toward being a database.** Feature requests must cite a lesson that needs
   them.
4. **Networking change weakens the sandbox.** Treat 0b as security-review-required;
   `internal=True` + control-API isolation are non-negotiable acceptance criteria.
