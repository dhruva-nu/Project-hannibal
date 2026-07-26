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
comes back as `-ERR unknown command`, logged under its own name.

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

## Run it

```sh
cargo run -p cannae -- --infra cache --control-bind 127.0.0.1:9900
redis-cli -p 6379 set user:1 ada
redis-cli -p 6379 get user:1

cargo run -p cannae -- --infra cache:16379,echo   # `name:port` overrides the default
```

`--infra` takes the emulators a lesson declares. `redis` is accepted as a second
spelling of `cache`: a lesson declares the *product* it wants (that is what
`rce-service`'s `INFRA_EMULATORS` sends), while the emulator identifies itself by its
*role* — `cache` is what a fault rule's `emulator` field names.

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

Pick a **preset** (`cache` or `echo`) and it sets the port, the wire framing, a fixture
worth seeding, and the actions that emulator actually registers. On the cache you type
commands (`SET user:1 ada EX 60`) and get `redis-cli`-shaped replies — `(nil)` and `""`
stay distinguishable, which is the distinction cache lessons turn on. `advance_clock` is
offered as what it is: an immediate action that applies on click and takes no trigger.

It is a host-side tool by design and is never built into the image: the shipped binary is
a static scratch build bound for a network-isolated student sandbox, where a debug UI and
a TCP client have no place.

## Test

```sh
cargo test              # unit tests + the echo and cache e2e acceptance tests
./compat/run.sh         # blessed-client matrix: redis-py, ioredis
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
```

The cache-aside milestone lesson is asserted three ways: in Rust over raw RESP
(`crates/cannae/tests/cache_e2e.rs`), and through each blessed client
([`compat/`](./compat/README.md)). All three grade from the op log, not from return
values — the same way the harness will.

## Build the static image

```sh
docker build -t cannae-service .   # FROM scratch, fully static musl binary
```
