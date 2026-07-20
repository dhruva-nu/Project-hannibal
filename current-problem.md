# Current Problem: Making infrastructure feel real without being real

## The problem

Hannibal courses hand the student a function skeleton and have them implement it. Example from a
banking course teaching **why transactions matter**:

```python
def transfer_money(user_a: User, user_b: User, amount: Decimal) -> bool:
    ...
```

The student writes the body — in **any language, with any library they choose** (psycopg2,
SQLAlchemy, JDBC, whatever). To verify their solution, the test cases must exercise real
database behavior: reads, writes, and — critically for this lesson — what happens when a
failure lands between the debit and the credit.

The same problem repeats for every infrastructure concept we teach: **queues** (RabbitMQ/Kafka
clients), **caching** (Redis clients), and eventually anything else with a client/server split.

## Hard constraints

1. **No handed mock objects.** We can't give the student a `MockDB` and tell them to call
   `mock_db.execute()`. That teaches our API, not the concept. The student must write the same
   code they'd write at a job.
2. **No real database.** We don't want to spin a Postgres container (or shared instance) per
   test run — cost, startup latency, cleanup, isolation between students.
3. **No fake-feeling in-memory substitutes.** SQLite-instead-of-Postgres or fakeredis-style
   monkeypatching breaks the moment the student picks a different library, and it *feels* fake —
   which kills the "you're building a real system" premise of the whole product.
4. **Language/library freedom.** The solution can't depend on shimming one specific client
   library, because we don't control which one the student imports.

## The key reframe

Constraint 4 is what kills every library-level mocking approach — but it also points at the
answer. If the student can use *any* client library, then the only interface we reliably
control is the one **all** of those libraries share: **the wire protocol over the network**.

psycopg2, SQLAlchemy, JDBC, node-postgres, and Go's pgx all speak the same PostgreSQL wire
protocol to port 5432. Every Redis client speaks RESP. Every RabbitMQ client speaks AMQP 0-9-1.

So: **"real" is defined by the wire protocol, not by the storage engine behind it.** A process
that speaks fluent Postgres wire protocol *is* Postgres as far as the student's code, their
library, and their debugging experience are concerned — even if behind the protocol handler
there's just a deterministic in-memory state machine we fully control.

This is not the same as an "in-memory fake" in the sense of constraint 3. The fake-feeling
comes from the student having to *use something different* (a mock object, a swapped driver, a
patched import). Here the student changes nothing: they `pip install psycopg2`, connect to
`db:5432`, and it works.

## Options considered

| Approach | Verdict |
|---|---|
| Hand student a mock object / DI interface | ❌ Violates constraint 1; teaches nothing transferable |
| Real Postgres/Redis/RabbitMQ container per run | ❌ Violates constraint 2; also can't deterministically inject faults mid-transaction |
| Library-level patching (fakeredis, sqlite swap) | ❌ Violates constraints 3 & 4; breaks per-library, per-language |
| Record/replay proxy in front of a real DB | ❌ Still needs the real DB somewhere; replay breaks on any variation in student code |
| **Protocol-level emulation inside the sandbox network** | ✅ **This is the one** |

## Verdict: protocol emulators on the sandbox network

Build (or adopt) lightweight servers that implement the **wire protocol** of each technology,
backed by an instrumented in-memory engine, and run them on the same Docker network as the
student's code inside the existing `rce-service` sandbox.

### Architecture

```
┌─────────────── sandbox network (per test run) ───────────────┐
│                                                              │
│  student container ──TCP:5432──▶  pg-emulator (wire proto)   │
│   (any language,   ──TCP:6379──▶  redis-emulator (RESP)      │
│    any client lib) ──TCP:5672──▶  amqp-emulator (AMQP 0-9-1) │
│                                                              │
│  test harness ──control API──▶  all emulators                │
└──────────────────────────────────────────────────────────────┘
```

- The student's code connects with ordinary connection strings we provide as env vars —
  exactly like a real deployment.
- Each emulator exposes a **control API** (separate port) that the test harness uses to:
  seed state, snapshot/reset between test cases, read the full operation log, and — the
  killer feature — **inject faults at exact points**.

### Why this is *better* than a real DB, not just cheaper

The banking lesson is about atomicity. With a real Postgres, how do you write a test that
kills the connection *between the debit UPDATE and the credit UPDATE*? You can't, not
deterministically. With an emulator you script it:

```
harness: fail_after(statements=1, within_connection=next)
→ student code debits A, then the "server" drops dead
→ assert: A's balance is unchanged (they used a transaction) or money vanished (they didn't)
```

That test *is the lesson*. Same pattern everywhere:

- **Queues**: deliver the same message twice → did they write an idempotent consumer?
- **Caching**: expire a key mid-request, return a stale value → did they handle invalidation?
- **Transactions**: deadlock two of their own connections → do they retry?

Real infrastructure makes these scenarios flaky and timing-dependent. A controlled emulator
makes them deterministic, reproducible, and gradeable. **The constraint ("no real DB") turns
into the product's edge.**

Second grading win: the emulator sees every protocol frame, so the harness can assert on
*behavior*, not just return values — "did they actually open a transaction?" is a log query
(`BEGIN` frame present before the first `UPDATE`), not a heuristic.

### Feasibility per technology (build order)

1. **Redis / RESP — easy.** RESP is a trivial protocol (~a weekend for the framing). Command
   semantics for the subset lessons need (GET/SET/EXPIRE/DEL/INCR, maybe pub/sub) are small.
   Start here; it proves the whole model.
2. **Postgres wire protocol — medium.** The protocol (startup, simple + extended query,
   auth) is well-documented and there are existing implementations to build on (e.g. Rust
   `pgwire`, Python `buenavista`). The real work is the SQL surface — but we only need the
   subset our lessons use (CRUD, transactions, constraints), and we author the lessons, so
   the subset is a design decision, not an open-ended parser project. Back it with an
   in-memory engine (or embed SQLite/DuckDB *behind* the pg wire front — invisible to the
   student, satisfies constraint 3 because they never touch it).
3. **AMQP 0-9-1 — hardest.** More stateful protocol (channels, acks, QoS). Implement the
   subset: declare/publish/consume/ack/nack. Kafka, if ever needed, is a bigger lift — defer.

### Risks / open questions

- **Protocol fidelity gaps.** Some client libraries probe server internals (e.g. ORMs
  querying `pg_catalog` on connect). Mitigation: test each lesson's "blessed" libraries
  against the emulator in CI; stub the common catalog queries. We don't need to support every
  library on earth — we need the ones students plausibly reach for, and a clear error when
  they go off-map.
- **SQL semantics drift.** Our engine might accept SQL real Postgres rejects (or vice versa).
  Acceptable for teaching *concepts*; keep the supported-SQL subset documented per lesson.
- **Scope creep.** The emulator must never try to be a database. It's a lesson prop with a
  protocol-shaped mouth. Feature requests are driven by lesson needs only.
- **Build vs adopt.** Survey existing pieces first (pgwire libs, RESP servers, `lavinmq`-style
  AMQP subsets) before writing frame parsers from scratch.

### Suggested first milestone

A caching lesson end-to-end: student writes `get_user_profile()` with cache-aside in any
language, connects to `redis://cache:6379` inside the existing RCE sandbox, and the harness
grades it by (a) asserting on the RESP operation log (did they check the cache before the
"DB"?) and (b) injecting a cache miss/expiry to verify fallback. Smallest protocol, exercises
the full architecture: emulator + control API + sandbox networking + log-based grading.
