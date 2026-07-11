# Plan: Simulation Harness — mocked infrastructure for build lessons

## Problem

Today a build lesson's verdict is a single sandboxed script: the student's code is
spliced into `test_code` at `--user-code--`, runs in a no-network Docker sandbox,
and prints `✓/✗ test name` lines that the frontend parses. For lessons about
DBs, queues, caches, or scaling there is **nothing for the student's code to
behave against** — the test can only check return values, so tests effectively
just pass. Concepts like durability, redelivery, transactions, and consistency
are about behavior under adversity, which a bare script cannot exercise.

A second, structural problem follows from the first: any harness library that
student code imports must exist **per language** (Python, JavaScript, Go), and
the `--user-code--` splice forces `test_code` into the student's language. A
`hannibal_sim` with three parallel implementations is not maintainable.

## Decision scorecard

The proposal (mocked infrastructure components) versus the amendments raised
during design review, and the final resolution for each.

| # | Position | Verdict | Resolution |
|---|---|---|---|
| 1 | Pre-defined catalog of mocked components (sql_db, nosql_db, queue, …) as in-process code, not real infra | ✅ Agreed | Foundation of the design. Runs inside the existing sandbox: deterministic, fast, zero new infrastructure. |
| 2 | Components talk to each other through controlled wiring | ✅ Agreed | Named simulator instances wired by connection string (`postgres://localhost/bank-db`), injected into the student process via env vars. |
| 3 | Middleware between student code and stub is the control point for success/failure | ✅ Agreed | The middleware owns faults, latency, routing, and observation. It is the product. |
| 4 | Students use real libraries (psycopg2, redis, …); the harness translates to the mock | ✅ Agreed — strongest property | Students write portable real-world code, not a Hannibal-flavored API. |
| 5 | In the course teaching concept X, the catalog's X is simply not provided — the student builds it against the same interface | ✅ Agreed | Curriculum invariant. Resolves the conflict with "the setup is the curriculum". |
| 6 | Simulate scale internally for scaling courses | ✅ Agreed, method attached | Discrete-event simulation on a virtual clock (simulate 1M requests in ms of CPU). Results are labeled *modeled*, never *measured*. |
| 7 | The stub itself can be fully dumb; the middleware controls everything | ⚠️ Amended | Middleware controls *when* things fail; the stub controls *what the world looks like after*. State-dependent lessons (redelivery after missed ack, rollback on failed commit, replica lag) require a minimal state machine per stub. Rule: **as dumb as possible, but no dumber than the concept being taught.** |
| 8 | Any client library should work | ✅ Agreed via protocol-level interception | Simulate at the **wire protocol** (pg-wire, RESP, AMQP) on the container's loopback interface instead of shimming libraries. One simulator per concept covers every library in every language. Caveats: real drivers demand protocol completeness (handshake, type OIDs, introspection queries), and speaking the protocol means handling SQL/commands — semantics move into the simulator. |
| 9 | Randomized, seeded scenarios | ❌ Rejected | **Fixed scenarios are kept.** Scenarios are authored explicitly per lesson. |
| 10 | Structured JSON verdict channel | ❌ Rejected | **`✓/✗` stdout parsing is kept** unchanged (`courseProgress.ts::parseTestOutput`). The harness prints the verdict lines. |
| 11 | Control surface shape: paired methods (`insert()` / `insert_fail()`) vs params vs rules | ⚠️ Amended | Neither paired methods (combinatorial explosion, pollutes the student-facing surface) nor data-plane params (test config in student code paths). **Two-plane design**: data plane = the real protocol, nothing extra; control plane = declarative fault rules, event triggers, and the assertion API, held only by the scenario. |
| 12 | Multi-language support without per-language `hannibal_sim` implementations | ✅ Resolved by construction | Students never import a harness library — they only speak wire protocols. The harness is **one static binary** shipped into every run image. For sim lessons the `--user-code--` splice is replaced by **process invocation**: the student's code is a standalone program the harness runs or starts as a service. Scenarios are authored once, in one language, and drive all student languages. |

## Converged architecture

```
┌─ sandbox container (network_mode=none — loopback only) ─────────────────┐
│                                                                          │
│  hannibal-harness (ONE static binary, same in every run image)           │
│  ├─ scenario runner        executes the lesson's scenario file           │
│  ├─ protocol fronts        pg-wire / AMQP / RESP servers on localhost    │
│  ├─ middleware             fault rules, latency rules, call log          │
│  ├─ stub state machines    transactions, unacked msgs, replicas          │
│  ├─ control plane          rules / triggers / assertions (scenario-only) │
│  ├─ student supervisor     invokes or starts the student program,        │
│  │                         injects component URLs via env vars           │
│  └─ verdict printer        "✓/✗ test name" lines on stdout (unchanged)   │
│                                                                          │
│  student program (SEPARATE process, any language)                        │
│  └─ real client libs → real wire protocols → localhost                   │
└──────────────────────────────────────────────────────────────────────────┘
```

Key properties:

- **One harness, N languages, zero ports.** The harness is a single static
  binary (implementation language is ours to pick — see Phase 1) baked into
  the Python, JS, and Go run images alike. Students never link against it.
- **Physical plane separation.** Student code arrives over the socket (data
  plane); the control plane exists only inside the harness process. Isolation
  is a property of the process split, not naming conventions.
- **The language boundary is the process boundary.** The harness talks to the
  student program only through language-neutral channels: argv, env vars, exit
  codes, and wire protocols. Nothing else is allowed to cross it.
- **Same sandbox, same verdict flow.** No change to the RCE topology, the
  RabbitMQ gateway, or stdout verdict parsing. Student stdout is relayed so
  the streaming panel still shows their prints.

## The student program contract

For sim lessons, the student writes a **complete small program**, not a spliced
fragment. The harness interacts with it in one of two modes, chosen per lesson:

- **invoke mode** — the harness runs the program per scenario step with
  arguments: `student transfer A B 40`. The program connects to components
  (URLs from env vars like `BANK_DB_URL`), does its work, exits. The harness
  judges exit code + world state. Fits function-shaped lessons.
- **service mode** — the harness starts the program once; it runs as a real
  service (queue consumer, HTTP handler). The harness drives the world
  (publishes messages, injects faults, advances the clock) and observes
  effects. Fits consumer/server-shaped lessons — which is also how the same
  code would run in production, reinforcing the pedagogy.

Per-language cost of this contract: **only the editor code template** (the
`main`/entrypoint boilerplate per language), which the existing
`/build-blocks/{id}/translate` dsl-service mechanism already produces, plus
client libs on the existing per-language package allowlists.

Non-sim lessons (pure algorithm/logic) keep the existing `--user-code--` splice
path unchanged. A build block opts into the harness with an
`execution_mode: "scenario"` field; `"splice"` remains the default.

## Scenario authoring

Because scenarios run inside the harness and never mix with student code, they
are written **once, in one language, for all student languages**. The scenario
language is an embedded scripting layer in the harness (Starlark recommended —
Python-like syntax, deterministic, sandboxed, mature Go implementation); a
declarative YAML format was considered and rejected as too weak for assertions.

```python
# scenario.star — one file per lesson, runs for every student language
db = sql_db("bank-db")
db.seed("accounts", [{"id": "A", "balance": 100}, {"id": "B", "balance": 0}])

student.run(["transfer", "A", "B", "40"])
check("transfer moves money", db.rows("accounts") == {"A": 60, "B": 40})

db.fail("commit", error="connection reset")
student.run(["transfer", "A", "B", "40"], allow_failure=True)
check("failed transfer leaves balances untouched",
      db.rows("accounts") == {"A": 60, "B": 40})
```

`check(name, bool)` prints the `✓/✗ name` line — the verdict channel is
unchanged end to end.

## Main plan

### Phase 1 — harness binary skeleton

- New top-level project `harness/` producing one static binary
  (recommendation: **Go** — single-binary cross-compile keeps every run image
  small, `starlark-go` gives the scenario layer for free; final call after a
  spike).
- Core: scenario runner (Starlark), control-plane object model, fault-rule
  engine, call log, virtual clock, student supervisor (invoke + service
  modes, env-var wiring, stdout relay).
- Bake the binary into all run images (`rce-service` `config.py` RUNTIME).
- `build_blocks` schema: `execution_mode: "splice" | "scenario"`, `scenario`
  (the Starlark source), and optional `limits: {timeout_s, mem_mb, pids}` —
  threaded through `run-simple` → `JobV1` → `docker.py`. Current defaults
  (10 pids / 128MB / 10s) are too tight for harness + student processes.

### Phase 2 — Queue simulator (first concept)

Chosen first: AMQP's state machine (deliveries, acks) *is* the curriculum for
the queues course, and the protocol is bounded. Ships with the "consumers &
acknowledgements" lessons in Python, then proves the multi-language claim by
enabling the same lesson for JS/Go **with no harness changes** — only new
editor templates.

### Phase 3 — SQL DB simulator

pg-wire front over an embedded engine (see sub-plan). Ships with the
transactions lessons.

### Phase 4 — Catalog growth + scale simulation

- `nosql_db` (Mongo wire), `cache` (RESP — cheapest protocol, could be pulled
  earlier), `load_balancer` (plain HTTP).
- Discrete-event scale simulation on the shared virtual clock: latency/capacity
  models per component, harness advances virtual time, reports modeled p99,
  queue depth, drop counts.

### Curriculum invariant (restated)

In the course that teaches concept X, the harness does not provide X. The
student implements the same interface, and their implementation is slotted into
the topology where the catalog component would sit — attacked by the same
scenarios.

---

## Sub-plan: control plane

The control plane is the scenario's handle on each simulator. It has three
responsibilities: **rules**, **triggers**, and **assertions**. There are no
fault variants on the data plane — the wire protocol surface is exactly the
real one, and the student process cannot reach the control plane at all
(process boundary).

### Rules — evaluated by the middleware on each data-plane call

Declarative, matched against `(operation, count, predicate)`:

```python
db.fail("commit", after_n=0, error="connection reset")   # next commit fails
db.fail("insert", nth=3, error="timeout")                # only the 3rd insert
db.delay("select", ms=200)                               # latency injection
q.drop_next_ack()                                        # swallow the ack
```

- A rule decides the *response* to a student-initiated call. It never mutates
  stub state directly — e.g. `fail("commit")` refuses the commit; the stub's
  transaction machinery performs the rollback.
- One generic `fail(op, when, kind)` replaces every would-be `insert_fail()`-
  style method. New fault kinds are data, not API surface.
- Teachable composite kinds are first-class where the ambiguity is the lesson,
  e.g. `error="timeout", committed=True` (the classic "commit succeeded but the
  client never heard back").

### Triggers — store-originated events fired at a scenario point

These are not responses to student calls; they create new events from the
stub's own state:

```python
q.redeliver_unacked()      # unacked messages return, redelivered=True
db.crash_replica()         # replica stops applying writes
clock.advance(ms=5000)     # virtual time: TTLs expire, visibility timeouts fire
```

A trigger is only expressible if the stub kept the relevant state — this is why
rule #7 requires the minimal state machine.

### Assertions — the control plane doubles as the inspection API

Scenario authors never need a second mechanism; assertions read the simulator's
ground truth, not student-visible state:

```python
db.rows("accounts")                     # ground truth
db.call_count("update", table="orders") # from the middleware call log
q.unacked_count()
q.calls("publish")                      # full call log for ordering checks
```

Verdicts are emitted by `check(name, bool)` → `✓/✗ name` on stdout.

---

## Sub-plan: SQL DB stub (`sql_db`)

### Protocol front

Postgres wire protocol v3, scoped to what real drivers need to function:

- Startup + trust auth, simple query protocol, extended protocol
  (Parse/Bind/Execute) because psycopg2/asyncpg/pgx use it for parameterized
  queries, correct type OIDs for the common types, proper `ErrorResponse`
  frames (SQLSTATE codes — students should see real error codes).
- Enough catalog surface that ORMs' on-connect introspection doesn't choke.
  Prior art to crib from: pgmock-style servers, postlite, buenavista.

### Engine decision: embedded SQLite behind the wire front

Speaking pg-wire means receiving SQL strings; parsing SQL ourselves is
unbounded maintenance. Instead: translate to an embedded per-instance SQLite
database. Real SQL semantics (joins, constraints, aggregates) come free; the
middleware wraps the engine for fault injection and the call log.

- Known dialect gaps (types, `RETURNING` behavior differences) are acceptable:
  lesson SQL is authored by us, and student SQL in early courses is simple. A
  dialect shim handles the few constructs lessons actually use.
- Escape hatch: if a lesson needs a Postgres-only behavior SQLite can't model,
  that behavior is implemented in the state-machine layer, not by swapping
  engines.

### State machine (the "no dumber than the concept" layer)

| Behavior | State kept | Lessons it enables |
|---|---|---|
| Transactions | uncommitted write set per connection (SQLite native) | atomicity, rollback on failed commit |
| Ambiguous commit | commit applied + error returned (rule-driven) | retries, idempotency keys |
| Replicas | versioned snapshots + configurable apply lag on virtual clock | stale reads, read-your-writes |
| Capacity | max connections, per-op cost on virtual clock | pooling, scale lessons |

Replicas/capacity land in Phase 4; Phase 3 ships transactions + ambiguous
commit only.

### Reference scenario (transactions lesson, invoke mode)

```python
# scenario.star
db = sql_db("bank-db")
db.seed("accounts", [{"id": "A", "balance": 100}, {"id": "B", "balance": 0}])

student.run(["transfer", "A", "B", "40"])          # BANK_DB_URL in env
check("transfer moves money", db.rows("accounts") == {"A": 60, "B": 40})

db.fail("commit", error="connection reset")
student.run(["transfer", "A", "B", "40"], allow_failure=True)
check("failed transfer leaves balances untouched",
      db.rows("accounts") == {"A": 60, "B": 40})   # unchanged — no half-transfer
```

The student's editor template (per language, via dsl-service translate) is the
entrypoint boilerplate: parse argv, connect with `BANK_DB_URL`, call the
function the student implements. A student using autocommit `UPDATE`s instead
of a transaction ends at `{"A": 20, "B": 40}` — the ✗ line is the lesson. The
same scenario file runs unmodified whether the student wrote Python, JS, or Go.

---

## Sub-plan: Queue stub (`queue`)

### Protocol front

AMQP 0-9-1, scoped to the teaching surface: connection/channel open,
`basic.publish`, `basic.consume`, `basic.ack` / `basic.nack`, `basic.qos`
(prefetch), default exchange + named queues. Explicitly out of scope until a
lesson needs them: topic/fanout exchanges, publisher confirms, transactions.
Target clients: pika (Python), amqplib (JS), amqp091-go.

### State machine

This state machine **is** the curriculum for the queues course, which is why
the queue ships first:

| State | Behavior | Lessons it enables |
|---|---|---|
| `ready` list | FIFO delivery, respects prefetch | consumers, backpressure |
| `unacked` map (delivery tag → message) | ack removes; missed ack keeps it | acknowledgements |
| redelivery | `redeliver_unacked()` trigger / visibility timeout on virtual clock moves unacked → ready with `redelivered=True` | at-least-once, idempotent consumers |
| nack + requeue flag | requeue or drop; optional dead-letter target | poison messages, DLQs |
| bounded queue | max-length + overflow policy | backpressure, load shedding |

Per the curriculum invariant: in the queues-building course this simulator is
withheld; the student implements the same interface and the same scenarios run
against their implementation.

### Reference scenario (idempotent consumer lesson, service mode)

```python
# scenario.star
q = queue("payments")
db = sql_db("orders-db")
db.seed("orders", [{"id": "o1", "status": "pending"}])

q.drop_next_ack()                        # middleware: swallow the first ack
q.publish({"order_id": "o1", "event": "paid"})

consumer = student.start()               # long-running process; QUEUE_URL, ORDERS_DB_URL in env
q.wait_deliveries(n=1)
q.redeliver_unacked()                    # state machine: m1 returns, redelivered=True
q.wait_deliveries(n=2)
consumer.stop()

check("duplicate delivery does not double-process",
      db.rows("orders")["o1"] == "paid"
      and db.call_count("update", table="orders", id="o1") <= 1)
check("message eventually acknowledged", q.unacked_count() == 0)
```

The student writes only the consumer program (template provides the
connect/consume boilerplate; the student implements the handler). Because the
harness owns delivery pacing and the clock, a student-owned loop cannot
swallow the scenario.

---

## Integration points (existing system)

| Touch point | Change |
|---|---|
| New `harness/` project | The single static binary: scenario runner, protocol fronts, middleware, stubs, control plane, student supervisor. |
| `rce-service` run images | Bake the harness binary into **all** language images; simulators listen on loopback (works under `network_mode=none`). |
| `rce-service` `handlers.py` | `execution_mode: "scenario"` jobs exec the harness (which supervises the student program) instead of the bare interpreter. |
| `build_blocks` schema (Mongo) | `execution_mode`, `scenario` (Starlark source), optional `limits: {timeout_s, mem_mb, pids}`; threaded through `run-simple` → `JobV1` → `docker.py`. |
| `--user-code--` splice | Unchanged for `"splice"` lessons. Not used by `"scenario"` lessons — student code is a standalone program. |
| dsl-service templates | Per-language entrypoint boilerplate for scenario lessons (the only per-language surface). |
| Verdicts | Unchanged. Harness prints `✓/✗` lines; `courseProgress.ts::parseTestOutput` parses as today. Student stdout is relayed for the streaming panel. |
| Package allowlist | Client libs students may use (psycopg2, pika, redis, …) added to the existing per-language allowlists in `rce-service`. |
| RCE topology / RabbitMQ gateway | No change. |

## Risks

- **Driver protocol completeness** is the main unknown for `sql_db` — budget a
  spike: psycopg2 + SQLAlchemy + pgx connecting and running the reference
  scenario before committing to Phase 3 scope.
- **Two processes in one sandbox** — harness + student — needs the per-block
  limit overrides landed first (Phase 1).
- **Service-mode termination**: a student consumer that never exits must be
  stopped by the harness (supervisor owns the child), and hang detection must
  produce a teaching message, not a bare timeout.
- **SQLite dialect gaps** surface as confusing errors if lesson SQL drifts
  Postgres-specific; mitigated by authoring lesson SQL against the simulator.
- **Scale numbers are modeled.** Every scale-lesson UI surface must present
  them as consequences of the model, not benchmarks.
