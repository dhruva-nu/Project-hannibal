# cannae-service

Protocol-level infrastructure emulators — students write real code with real client
libraries against what they believe is Postgres / Redis / RabbitMQ / MongoDB, but is
actually a deterministic, instrumented emulator we fully control.

Full rationale: [`../current-problem.md`](../current-problem.md). Plan and phases:
[`../plans/infra-emulators.md`](../plans/infra-emulators.md).

## The crates

- `crates/cannae-core` — the kit: connection front, operation log, fault engine,
  control plane. Protocol-agnostic; written once in Phase 0 (#132).
- `crates/cannae-echo` — the trivial proving emulator (line echo, `:7777`).
- `crates/cannae-cache` — **Redis (RESP2) on `:6379`** (Phase 1, #134).
- `crates/cannae-sql` — **PostgreSQL (wire v3) on `:5432`** (Phase 2, #135).
- `crates/cannae` — the binary: parses run config, starts declared emulators.

A protocol plugs in by implementing `Emulator` from *outside* `cannae-core`. Phases 1–4
add only `decode` / `execute` / `apply_fault` / `encode_error` / `matches` plus their
registered actions — never how a fault travels from `:9900` to the student's socket.

### Architecture

A fault is **armed on the control plane** and **fired on the data plane** — both share
one process and one fault engine:

```
  harness ──▶ :9900  control plane   POST /faults ─▶ engine.install   (armed)
  student ──▶ :port  data plane      per op ─▶ engine.evaluate        (fires)
```

Every op runs one pipeline: `decode → oplog.append → faults.evaluate → execute-or-fault → respond`.

### Control API

| Endpoint | Purpose |
|---|---|
| `POST /seed` | load state; snapshot it as the reset baseline |
| `POST /reset` | restore baseline; clear log, rules, counters |
| `GET /log` | the op log (`?emulator=` to filter) |
| `POST /faults` | arm a declarative fault rule |
| `DELETE /faults` | clear all rules |
| `GET /state?emulator=` | dump engine state for assertions |

Fault-rule contract (one shape for all emulators):

```json
{ "emulator": "cache", "action": "kill_connection",
  "after": { "op_matches": "GET", "count": 1 }, "times": 1, "conn": "any", "params": {} }
```

`after.op_matches` names an op type as it appears in the log, an op **class** the
protocol registers, or `connect`. Anything else is a 400 at install time — a rule that
could never fire is the worst failure mode for a grading harness.

**Triggered vs immediate.** Most actions arm and fire later. A protocol may also
register *immediate* actions that apply at install time and take no `after` — the
cache's `advance_clock` is one. Protocol-specific arguments always go in `params`:

```json
{ "emulator": "cache", "action": "advance_clock", "params": { "seconds": 61 } }
```

## The cache emulator (Redis, RESP2)

Real Redis clients connect unmodified. What makes it useful is the part real Redis
cannot do.

**Commands** — the subset caching lessons need, grown lesson-by-lesson:
`GET MGET SET SETNX SETEX DEL EXISTS EXPIRE TTL INCR INCRBY`, plus the handshake
commands clients issue before they will talk (`PING SELECT HELLO CLIENT COMMAND INFO
QUIT`). `HELLO 3` is refused, which is how clients fall back to RESP2. Anything else
comes back as `-ERR unknown command`, logged under its own name. Mutually exclusive `SET`
options (`NX XX`, `EX` twice) are a syntax error, as they are in real Redis.

**Framing** — RESP2 arrays of bulk strings only; inline commands (telnet) are not
supported, because a lesson prop serves client libraries. One command may carry at most
1024 arguments and 8MB of payload *in total* — a ceiling, not a per-argument one, since
the emulator container has 128MB and the client is untrusted student code. A frame past
either limit, or a payload that does not end where its header promised, closes the
connection rather than resyncing mid-stream.

**Deterministic time** — every TTL runs off a logical clock that only moves when the
harness says so. "The cache entry expired" is a scripted event, not a sleep:

```json
{ "emulator": "cache", "action": "advance_clock", "params": { "seconds": 61 } }
```

**Faults** — `kill_connection`, `inject_error`, `delay` from the kit, plus:

| Action | Effect |
|---|---|
| `expire_key` | drops the key on the op that trips the rule, so that read — and every one after — is a miss |
| `serve_stale` | answers with `params.value` once; the stored entry, TTL and all, is never touched |

Both take an optional `params.key` to target one key; without it they act on whatever
keys the triggering op touched. Op classes `read` (`GET|MGET`) and `write`
(`SET|SETNX|SETEX|DEL|INCR|INCRBY|EXPIRE`) let a rule say "on the first read".

Two pairings are refused when a rule is armed rather than misbehaving when it fires:
`serve_stale` on a write (it restores the real entry after the op, which would revert
the write while the client is told `+OK`), and either action on a trigger that names no
key (`PING`, `connect`) unless the rule supplies `params.key`.

**Where it diverges from real Redis** — deliberately, and only here:

| | Real Redis | Here |
|---|---|---|
| `TTL` rounding | `(remaining + 500) / 1000`, so 1200ms left reports `1` and 400ms reports `0` | rounded up, so any life left reports at least `1` — a lesson never sees a live key claim `0` seconds |
| `SELECT 1` | selects db 1 | `-ERR DB index is out of range`; one keyspace, honestly |
| `HELLO 3` | RESP3 | `-NOPROTO`, the signal clients use to fall back to RESP2 |
| unknown command | `-ERR unknown command 'X', with args beginning with: …` | `-ERR unknown command 'X'` |

A lesson that asserts an exact `TTL` should use a whole number of seconds, where the
two agree.

**Seeding** — a lesson fixture is a keyspace. An entry is a bare value or an object
with exactly one lifetime field (`ttl_seconds`, `ttl_ms`, or `expires_at_ms`):

```json
{ "emulator": "cache", "keys": {
    "user:1": "{\"name\":\"Ada\"}",
    "session:7": { "value": "token", "ttl_seconds": 60 } } }
```

`GET /state?emulator=cache` returns live keys with their *remaining* TTL, which is what
a grader asserts on. Seeding replaces the whole keyspace and snapshots it as the reset
baseline; `/reset` rewinds the keys, the clock, the log, and the counters together.

**One database.** `SELECT 1` is an error rather than a silent alias to db 0 — a lesson
that believed it had two keyspaces would grade nonsense.

## The SQL emulator (PostgreSQL, wire protocol v3)

Real Postgres drivers and ORMs connect unmodified. Behind the protocol is **SQLite
in-memory**, which the student never meets — the decision, and why it is not a
hand-written SQL engine, is `plans/infra-emulators.md` §4.

**Protocol** — startup with trust auth, `ParameterStatus`, and `ReadyForQuery` carrying
a truthful `I`/`T`/`E` transaction status. Both query styles: the **simple** query
(`Q`), and the **extended** flow (`Parse`/`Bind`/`Describe`/`Execute`/`Sync`) that
node-postgres, psycopg3 and JDBC require, including row limits that suspend a portal.
`SSLRequest` is refused with `N` and every blessed client carries on in plaintext.

**SQL surface** — the subset a lesson needs, and the subset is a *design decision*:
`SELECT INSERT UPDATE DELETE`, `BEGIN COMMIT ROLLBACK`, DDL, `RETURNING`, `ON CONFLICT`,
constraints (`CHECK`, `UNIQUE`, `NOT NULL`, `REFERENCES` — foreign keys are **enforced**),
and `SET`/`SHOW`. Anything outside it fails loudly with a real SQLSTATE, because a
divergence a student can see beats one a grader cannot. Four rewrites bridge the two
dialects and nothing else is touched: `$1` → `?1`, `SERIAL PRIMARY KEY` →
`INTEGER PRIMARY KEY AUTOINCREMENT`, `ILIKE` → `LIKE`, and `now()` /
`CURRENT_TIMESTAMP` → a fixed timestamp. **Every other type name survives verbatim**,
which is what makes a lesson's own DDL the type manifest: `balance NUMERIC(12,2)` is
created as exactly that, so the column reports OID 1700 and renders at scale 2.

**Transactions** — tracked per connection, and the tracking is both a protocol
obligation and the grading signal. Each connection holds its own SQLite handle onto one
shared in-memory database, so two student connections have genuinely independent
transactions and can *conflict* — which is what a retry lesson needs. Every statement is
logged with the transaction state it ran under:

```json
{ "op": "UPDATE", "conn_id": 1, "seq": 3,
  "args": { "sql": "UPDATE accounts SET …", "tables": ["accounts"], "in_transaction": true } }
```

That turns "did a transaction wrap both writes?" into an assertion rather than a guess.
A failed block refuses everything but `COMMIT`/`ROLLBACK` (`25P02`), and `COMMIT` on a
failed block answers `ROLLBACK` — a client that reported "committed" would hide a lost
transaction.

**Catalog probes** — the fixed set drivers and ORMs fire before they will talk:
`version()`, `current_schema()`, `current_database()`, `current_user`, `SHOW <setting>`
(including the multi-word `SHOW TRANSACTION ISOLATION LEVEL`), `SET`/`RESET` accepted and
ignored, and empty `pg_type` / `pg_namespace` / `pg_class` / `pg_extension` tables.
**Every entry exists because a blessed client failed without it** — grown from compat
failures, never from speculation. An unrecognised probe reaches the engine and comes back
as a real `42P01`, because a probe answered with a plausible lie is a divergence nobody
can see.

**Faults** — all four the phase needs are the kit's own; what this emulator adds is what
they look like on the wire, plus the op classes that make them expressible:

| Lesson scenario | Rule |
|---|---|
| kill after the Nth statement | `kill_connection`, `after: {op_matches: "statement", count: N}` |
| kill *inside* an open transaction | `kill_connection`, `after: {op_matches: "in_transaction", count: N}` |
| retryable serialization failure | `inject_error`, `params: {"sqlstate": "40001"}` |
| deadlock | `inject_error`, `params: {"sqlstate": "40P01"}` |
| per-statement latency | `delay`, `params: {"ms": 200}` |

Op classes: `statement` (any), `read` (`SELECT`), `write` (`INSERT|UPDATE|DELETE|TRUNCATE`),
`transaction` (`BEGIN|COMMIT|ROLLBACK`), and **`in_transaction`** — any statement that ran
with a block already open. That last one is read off the logged op, so the trigger and the
evidence a grader reads agree by construction.

`params.table` narrows a rule to statements touching one table. Two pairings are refused
when a rule is armed rather than misbehaving when it fires: `inject_error` without a
`params.sqlstate` (the code is what a student's `except` clause matches, so defaulting it
would make a retry test that never retries), and `params.table` on a trigger that names no
table.

**An injected error aborts the transaction**, exactly as any real error does. Without
that the client would be told its transaction was poisoned while the engine went on to
commit it — and a student who never wrote a retry would pass.

**Seeding** — a lesson fixture is Postgres DDL plus rows:

```json
{ "emulator": "sql",
  "schema": ["CREATE TABLE accounts (id SERIAL PRIMARY KEY, owner TEXT NOT NULL UNIQUE, balance NUMERIC(12,2) NOT NULL CHECK (balance >= 0))"],
  "rows": { "accounts": [ { "owner": "ada", "balance": "1000.00" } ] } }
```

`schema` is one SQL string or a list of them; a row names only the columns it sets, so a
`SERIAL` or defaulted column may be left out. `GET /state?emulator=sql` returns every
table's and view's rows in insertion order, which is what a grader asserts on. **Money is
a string** there (`"900.00"`), deliberately: a `NUMERIC(12,2)` balance is an exact decimal
and a JSON number is a double. Names beginning `pg_` are reserved for the catalog stubs,
as they are in real Postgres.

**Where it diverges from real Postgres** — deliberately, and only here:

| | Real Postgres | Here |
|---|---|---|
| isolation | MVCC: a reader never blocks | shared-cache table locking, so a read against another connection's open write transaction is a `40001`. A conflict is the lesson, and this is the shape that produces one |
| a computed integer column | `SELECT 1` is `int4`, `count(*)` is `int8` | both `int8`. Clients that render int8 as a string (node-postgres) show `"1"` for `SELECT 1`; select a declared column if a lesson cares |
| `Describe` on a computed column | the real type | `text` — there are no rows yet to infer from, and every type here decodes from text |
| binary format | supported | refused with `0A000`. A value read with the wrong codec is a wrong answer that looks like a right one; every blessed client uses text |
| `now()` / `CURRENT_TIMESTAMP` | the wall clock | a fixed timestamp — two runs of a scenario must produce identical rows |
| constraint-violation messages | names the constraint | SQLite's wording. The SQLSTATE is exact, which is what a driver branches on; inventing a constraint name would be a lie a lesson could match on |
| `SSL`, real auth, `pg_catalog` shape queries (reflection) | supported | out of scope (`plans/infra-emulators.md` §10) |

A missing table or column *is* translated — `relation "accounts" does not exist` rather
than SQLite's wording — because that is the commonest error a student meets and SQLite
hands back the exact identifier for it.

## Run it

```sh
cargo run -p cannae -- --infra sql --control-bind 127.0.0.1:9900
psql "postgresql://student:student@127.0.0.1:5432/app" -c 'select 1'

cargo run -p cannae -- --infra cache --control-bind 127.0.0.1:9900
redis-cli -p 6379 set user:1 ada
redis-cli -p 6379 get user:1

cargo run -p cannae -- --infra sql,cache:16379,echo   # `name:port` overrides the default
```

`--infra` takes the emulators a lesson declares. `redis` is accepted as a second spelling
of `cache`, and `postgres` / `postgresql` of `sql`: a lesson declares the *product* it
wants (that is what `rce-service`'s `INFRA_EMULATORS` sends), while the emulator
identifies itself by its *role* — `cache` and `sql` are what a fault rule's `emulator`
field names. Two spellings of one emulator in one `--infra` list is refused by name
rather than discovered as an `AddrInUse`.

## Manual testing dashboard

For poking an emulator by hand — seed a keyspace, arm a fault, drive real sockets,
watch the op log fill:

```sh
cargo run -p cannae -- --infra cache --control-bind 127.0.0.1:9900   # in one shell
python3 tools/dashboard.py                                           # in another
# open http://127.0.0.1:8080
```

Stdlib only, no dependencies. It serves the page, proxies the control API under `/api`
(so the browser stays same-origin), and holds a pool of raw TCP sockets the page drives
— **each connection card is a real client socket**, so opening two exercises `conn`
scoping (`any` / `next` / id) the way a lesson would.

Pick a **preset** (`sql`, `cache` or `echo`) and it sets the port, the wire framing, a
fixture worth seeding, the op classes that emulator registers, and the actions it
actually accepts. On the cache you type commands (`SET user:1 ada EX 60`) and get
`redis-cli`-shaped replies — `(nil)` and `""` stay distinguishable, which is the
distinction cache lessons turn on. `advance_clock` is offered as what it is: an immediate
action that applies on click and takes no trigger.

On **sql** you type statements and get `psql`-shaped output, including the transaction
status after every one:

```
 owner | balance
-------+---------
 ada   | 1000.00
(1 row)
SELECT 1
-- in transaction
```

That last line is the emulator's own transaction tracking. Watching it move to
`transaction aborted` and back is how you check by hand that a fault did what a lesson
claims. The dashboard does the Postgres handshake for you when a connection opens, so a
card is a real client socket from the first statement.

It is a host-side tool by design and is never built into the image: the shipped binary is
a static scratch build bound for a network-isolated student sandbox, where a debug UI and
a TCP client have no place.

## Test

```sh
cargo test              # unit tests + the echo, cache and sql e2e acceptance tests
./compat/run.sh         # blessed clients: redis-py, ioredis, psycopg2, SQLAlchemy, node-postgres
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
```

Each phase's milestone lesson is asserted several ways, and every one of them grades from
`/state` and the op log rather than from a return value — the same way the harness will:

- **cache-aside** (#134) — in Rust over raw RESP (`crates/cannae/tests/cache_e2e.rs`), and
  through redis-py and ioredis.
- **banking / `transfer_money()`** (#135) — in Rust over raw protocol v3
  (`crates/cannae/tests/sql_e2e.rs`), and through psycopg2, SQLAlchemy and node-postgres.
  Each proves the happy path, a scripted crash between the debit and the credit that
  leaves the bank's total untouched *when a transaction is used* and 100.00 short when it
  is not, and an op-log assertion that a transaction wrapped both writes.

See [`compat/`](./compat/README.md) for why one emulator needs three clients.

## Build the static image

```sh
docker build -t cannae-service .   # FROM scratch, fully static musl binary
```

The build happens on `rust:alpine`, which is natively musl, so it is an ordinary build
rather than a cross one. That matters now that the SQL emulator embeds SQLite from source:
a C compiler targeting musl has to be present, and the base image is pinned to at least
the workspace's `rust-version`. CI asserts the *shipped* binary is fully static by
copying it out of the image, then boots the image and checks every declared emulator
bound its port.
