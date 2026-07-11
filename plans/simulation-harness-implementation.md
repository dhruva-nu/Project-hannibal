# Implementation Plan: Simulation Harness (harness + queue + sql_db)

Companion to [simulation-harness.md](./simulation-harness.md) (the design). This
document decides the implementation language, corrects the design against the
real codebase, and lays out the build order with file-level touch points.

---

## Decision: write the harness in Python

The design doc recommended Go "pending a spike". After reconnaissance of the
actual RCE service, the recommendation flips to **Python** — the whole harness,
not just the stubs. (The stubs cannot be a different language than the harness:
protocol front → middleware → stub is one process.)

### Why Python wins here

1. **Dev speed, which is the stated priority.** One person, backend already
   Python, no new toolchain, no cross-compile pipeline.
2. **Go's headline advantage is void in this codebase.** Go was recommended for
   "single static binary baked into run images" — but there *are no run image
   builds today*. Sandboxes use stock `python:3.11-alpine` / `node:20-alpine`
   pulled lazily (`rce-service/rce_service/config.py:9,20`,
   `docker.py:35-41`). Baking in *any* artifact — Go binary or Python package —
   requires introducing a run-image build step either way. Once that step
   exists, "add a Python package to an Alpine image" and "add a Go binary" cost
   the same.
3. **The Python ecosystem shortcuts the two hardest components:**
   - **pg-wire front**: `buenavista` is an existing *Python* Postgres
     wire-protocol server library (already named as prior art in the design).
     Crib or depend on it instead of writing frame marshalling from scratch.
   - **AMQP front**: `pika.spec` contains the complete AMQP 0-9-1 frame
     encode/decode machinery — usable server-side. We implement the broker
     state machine, not the wire format.
   - **SQL engine**: `sqlite3` is stdlib. Zero-dependency embedded engine.
4. **Starlark becomes unnecessary.** Starlark was chosen because `starlark-go`
   is free with Go. With a Python harness, scenarios are simply **Python
   executed via `exec()` with a curated globals namespace** (`sql_db`, `queue`,
   `student`, `check`, `clock` — nothing else). Security is not the scenario
   layer's job: scenarios are lesson content authored by us, and they run
   inside the same `network_mode=none`, `nobody`-user, read-only-fs sandbox as
   everything else. The sandbox is the security boundary. This deletes an
   entire dependency and keeps scenario syntax identical to the design doc's
   examples.
5. **Performance is a non-issue at this workload.** One student process, a
   handful of loopback connections, rows measured in tens. The Phase 4
   discrete-event simulation runs on a *virtual* clock — it's pure computation,
   and simulating even 1M events in Python is seconds, well under a per-run
   timeout we control per block.

### Costs accepted, and mitigations

| Cost | Mitigation |
|---|---|
| JS run image (`node:20-alpine`) has no Python | Custom run images (needed anyway, see Phase 1). `apk add python3` on Alpine adds ~50 MB. Acceptable; revisit with a zipapp+static-python or PyInstaller artifact only if image size ever matters. |
| Python threads count against `pids_limit` | Harness is a single-process asyncio program (protocol fronts, supervisor, scenario runner all on one event loop). Budget: harness ≈ 2-3 tasks, student interpreter + its threads gets the rest. Scenario blocks override `pids` anyway (Phase 1). |
| Slower cold start than a Go binary | Interpreter startup ~50-100 ms inside an already-running container; invisible next to container start + 10 s job budget. |
| A future rewrite if Python ever becomes the bottleneck | The architecture makes this cheap: the harness↔student boundary is argv/env/wire-protocols, and the harness↔platform boundary is the JobV1 message + stdout. Nothing about the design is Python-shaped. |

**Verdict: Python 3.11+, asyncio, packaged as a normal `uv` project, delivered
into custom run images.**

---

## Corrections from codebase recon (design doc amendments)

Facts verified in source that the design must account for:

1. **No run-image build step exists.** `docker.py:_pull_missing_images`
   (`docker.py:35-41`) pulls stock images. Phase 1 must introduce
   `hannibal-run-python` / `hannibal-run-node` Dockerfiles + a build/pull
   policy in rce-service.
2. **Sandbox posture** (`docker.py:_start_container:62-86`): `network_mode="none"`
   (loopback still exists — protocol fronts on `127.0.0.1` work),
   `read_only=True` rootfs with 64 MB tmpfs `/tmp`, `user=65534:65534`,
   `cap_drop=ALL`, `no-new-privileges`, default seccomp. Harness must be
   **baked into the image** (read-only fs) at e.g. `/opt/hannibal/`, owned
   world-readable.
3. **Limits are hard host-side caps**: 10 s via `container.wait(timeout=...)`
   (`docker.py:109`) and `threading.Timer(...kill)` (`docker.py:179`); 128 MB;
   `pids_limit=10` — and the run-phase `Semaphore(5)` comment
   (`docker.py:20-21`) documents the host math as 5×10=50 PIDs. Raising
   per-block pids changes that envelope → the semaphore/pids interaction must
   be re-budgeted, not just the per-container number.
4. **The splice happens in the backend, not rce-service**:
   `backend/app/services/rce_gateway/test_code.py:add_test_code:16-26`
   (`--user-code--` at line 13). Scenario blocks bypass this function entirely.
5. **`JobV1` is duplicated by design** in
   `rce-service/rce_service/contracts.py:20-25` and
   `backend/app/services/rce_gateway/contracts.py` — new fields must land in
   both, with `CONTRACT_VERSION` handling.
6. **`build_blocks` has no `language` field** (language is a request param,
   `backend/app/schemas/run_code.py:10`) and fields are:
   `instructions, input, output, test_code, code_template, type, tests, obj_id`
   (`backend/app/models/build_block_model.py:12-24`). New fields:
   `execution_mode`, `scenario`, `limits`.
7. **Stream mode merges stdout+stderr and hardcodes `exit_code=0`**
   (`docker.py:186`, `handlers.py:75`). Verdict parsing
   (`frontend/src/pages/CoursePage/courseProgress.ts:parseTestOutput:9-27`)
   treats `exit_code===0` as all-pass shortcut (`:35`) — **scenario runs must
   go through sync mode** (which `run-simple` already uses) or the exit-code
   shortcut will mask failures. Streaming for service-mode lessons is a
   later, separate fix.
8. **Python installer uses `--only-binary=:all:`** (`deps/python.py:40-53`) —
   allowlist additions must be wheel-available: `psycopg2-binary` (not
   `psycopg2`), `pika` (pure Python), `redis` (pure Python).
9. **Deps cache is mounted read-only at run time** — harness dependencies
   cannot come from the student package cache; they must be in the image.

---

## Phase 0 — Spikes (throwaway, ~2-3 days total, can run in parallel)

**S1. Two processes in the sandbox.** Hand-run a container with the exact
`_start_container` posture but `pids_limit=64, mem=256m, timeout=30`: a tiny
asyncio Python "harness" that opens a loopback TCP server, spawns a child
`python -c "..."` client, relays its stdout, prints `✓ ok`. Proves: loopback
under `network_mode=none`, PID budget, nobody-user process spawning, stdout
interleaving. *Exit criterion: `✓ ok` arrives via `container.logs`.*

**S2. pg-wire reality check** (gates Phase 3 scope, per design-doc risk #1).
Stand up `buenavista` (or minimal crib) over stdlib `sqlite3`; connect with
psycopg2 **and** SQLAlchemy; run the bank-transfer reference scenario SQL.
*Exit criterion: `BEGIN/UPDATE/UPDATE/COMMIT` and a mid-transaction error path
work; note every protocol message SQLAlchemy needed at connect time.*

**S3. pika against a hand-rolled server.** Serve connection open → channel
open → `basic.publish`/`basic.consume`/`basic.ack` using `pika.spec` for
framing. *Exit criterion: pika client publishes and consumes one message
round-trip.*

---

## Phase 1 — Harness skeleton + platform plumbing

### 1a. New top-level project `harness/`

`uv` project, Python 3.11 (matches run image), zero heavy deps.

```
harness/
  pyproject.toml
  hannibal_harness/
    __main__.py          # entrypoint: harness <scenario-file> -- <student argv...>
    scenario.py          # exec()-based runner; curated globals; check()
    registry.py          # named component instances; env-var URL wiring
    middleware.py        # fault-rule engine (fail/delay, after_n/nth), call log
    clock.py             # virtual clock (advance(), timers for TTL/visibility)
    supervisor.py        # student process: invoke + service modes, stdout relay,
                         #   env injection, kill-on-scenario-end, hang→teaching msg
    verdict.py           # ✓/✗ printer (the ONLY writer of verdict lines)
    fronts/              # protocol servers (empty in Phase 1)
    stubs/               # state machines   (empty in Phase 1)
  tests/                 # pytest; 100% coverage per repo policy
```

Phase-1 scenario globals: `student`, `check`, `clock` only. End-to-end proof
scenario: `student.run(["..."])` + `check("exit ok", student.exit_code == 0)`
with a trivial student program — no stubs needed.

Design rules carried from the design doc: rules never mutate stub state
(middleware refuses the call; the stub reacts); control plane objects are only
reachable from scenario globals — the student process can't touch them
(process boundary).

### 1b. Run images (new)

- `rce-service/run-images/python/Dockerfile` — `FROM python:3.11-alpine`,
  `COPY harness /opt/hannibal`, deps installed into the image.
- `rce-service/run-images/node/Dockerfile` — `FROM node:20-alpine`,
  `apk add python3`, same `/opt/hannibal`.
- `config.py` `RUNTIME` images → `hannibal-run-python`, `hannibal-run-node`;
  `_pull_missing_images` grows a build-or-pull policy (compose builds them;
  document in README).
- Images tagged/pinned per the repo's pinned-base-image convention (#124).

### 1c. Contract + backend threading

- `JobV1` (both `contracts.py` copies): add
  `execution_mode: Literal["splice","scenario"] = "splice"`,
  `scenario: str | None`, `limits: {timeout_s, mem_mb, pids} | None`.
  Old workers reject unknown-version messages — bump handling per
  `CONTRACT_VERSION` (`rce-service/rce_service/contracts.py:15`).
- `build_block_model.py` + `schemas/build_block.py`: `execution_mode`
  (default `"splice"`), `scenario`, `limits`.
- `run_code_controller.py:/run-simple:25-62`: branch — splice blocks go
  through `add_test_code` unchanged; scenario blocks send the **raw student
  code** + scenario + limits in the job. Always sync mode (recon fact #7).
- `docker.py`: `run_code` accepts per-job limit overrides (timeout, mem,
  pids); command for scenario jobs becomes
  `sh -c "<decode code to /tmp/prog.ext> && python3 /opt/hannibal <scenario in /tmp> -- <cmd template>"`.
  Scenario text travels base64 in the same command envelope the code does
  (`_build_exec_context` pattern, `docker.py:53-59`).
- Re-budget `Semaphore(5)` (`docker.py:21`) against the new max pids
  (e.g. 5×64 — decide an explicit host ceiling and document it).
- `handlers.py:handle_sync` unchanged in shape; verdict flows back as today.

### 1d. Definition of done (Phase 1)

A scenario-mode build block in Mongo, run from the real frontend, executes a
student program under the harness and renders ✓/✗ results through the
untouched `parseTestOutput`. Splice blocks show zero behavior change
(regression: existing e2e smoke tests still green).

---

## Phase 2 — Queue stub (`queue`) — first concept

Why first: the ack state machine *is* the queues curriculum, AMQP subset is
bounded, and spike S3 de-risked framing.

### 2a. Protocol front — `fronts/amqp.py`

AMQP 0-9-1 subset over asyncio + `pika.spec` framing: connection/channel open,
`basic.publish`, `basic.consume`, `basic.ack`, `basic.nack`, `basic.qos`,
default exchange + named queues. Out of scope until a lesson needs them:
topic/fanout, publisher confirms, transactions. Target clients: pika, amqplib.
(`pika.spec` gives Python framing free; amqplib compatibility is the
cross-language test in 2d.)

### 2b. State machine — `stubs/queue.py`

Exactly the design doc's table: `ready` FIFO respecting prefetch, `unacked`
map keyed by delivery tag, redelivery (trigger + visibility timeout on the
virtual clock, `redelivered=True`), nack with requeue/DLQ, bounded queue with
overflow policy.

### 2c. Control plane — scenario global `queue(name)`

Rules: `q.drop_next_ack()`, generic `q.fail(op, when, kind)`.
Triggers: `q.redeliver_unacked()`, `clock.advance(ms=...)`.
Assertions: `q.unacked_count()`, `q.calls("publish")`, `q.wait_deliveries(n=)`.

### 2d. Ship with lessons

- Package allowlists: `pika` → `deps/python.py:68`, `amqplib` →
  `deps/javascript.py:72` (and mirror in
  `backend/app/services/package_search/package_meta.py`).
- dsl-service templates: consumer-boilerplate entrypoint per language
  (`dsl-service/src/codegen/python.rs` is currently a passthrough stub —
  scenario lessons need real templates; smallest viable change is
  per-language template strings keyed by block).
- Author the "consumers & acknowledgements" and "idempotent consumer"
  scenarios (service mode — supervisor `student.start()/stop()`).
- **Multi-language proof**: run the identical scenario against a JS consumer
  with zero harness changes. This is the acceptance test for the whole
  architecture.

---

## Phase 3 — SQL DB stub (`sql_db`)

Gated on spike S2 results.

### 3a. Protocol front — `fronts/pgwire.py`

Postgres wire v3 scoped by S2's findings: startup + trust auth, simple +
extended protocol (Parse/Bind/Execute — psycopg2 parameterized queries),
correct type OIDs for common types, real `ErrorResponse` frames with SQLSTATE
codes, minimum catalog surface S2 showed SQLAlchemy touching. Base on/crib
from `buenavista`.

### 3b. Engine — `stubs/sql_db.py`

One in-memory `sqlite3` database per named instance; one SQLite connection per
student connection (gives per-connection uncommitted write sets natively).
Dialect shim for the few Postgres-isms lesson SQL uses; anything SQLite can't
model is implemented in the state-machine layer, never by swapping engines.

### 3c. State machine (Phase 3 scope only)

- **Transactions**: SQLite-native BEGIN/COMMIT/ROLLBACK; `fail("commit")`
  refuses the commit and the stub rolls back.
- **Ambiguous commit**: rule-driven `error="timeout", committed=True` —
  commit applies, error returned. (Retries/idempotency lessons.)
- Replicas + capacity explicitly deferred to Phase 4.

### 3d. Ship with lessons

- Allowlist: `psycopg2-binary` (wheel-only constraint, recon fact #8),
  JS `pg`.
- Transactions lesson (invoke mode) — the bank-transfer reference scenario
  from the design doc runs verbatim (it is already valid Python).

---

## Phase 4 — later (out of scope here, unchanged from design doc)

`nosql_db` (Mongo wire), `cache` (RESP — cheapest front, pull earlier if a
lesson needs it), `load_balancer`, replicas/capacity for `sql_db`,
discrete-event scale simulation on the shared virtual clock (results labeled
*modeled*).

---

## Testing strategy (repo policy: 100% coverage, fail loudly)

- **harness/tests** — pure pytest, no Docker: scenario runner semantics,
  fault-rule matching (`after_n`/`nth`), virtual clock timers, queue state
  machine transitions, verdict formatting. Protocol fronts tested with real
  clients (pika/psycopg2) against the front on an ephemeral loopback port —
  this doubles as the driver-compat suite.
- **rce-service/tests** — extend existing suite: limit-override threading,
  scenario command construction (mock Docker as today).
- **backend/tests** — `run-simple` branching, contract fields, block schema
  (services mocked via `app.dependency_overrides`, never real DB).
- **e2e** — one scenario-mode smoke test alongside the existing e2e smoke
  suite (#122): seed a scenario block, run, assert ✓ lines.

## Sequencing summary

```
S1 sandbox spike ─┐
S3 pika spike ────┼→ Phase 1 (harness + images + contract) → Phase 2 (queue, py) → Phase 2 (queue, js — proof)
S2 pg-wire spike ─┘                                        ↘ Phase 3 (sql_db) after S2 verdict
```

## Risks (delta to design doc's list)

- **Contract version bump** must not strand in-flight jobs during deploy —
  worker rejects unknown versions; deploy worker before backend.
- **`node:20-alpine` + `apk add python3` drift**: pin the Alpine python3
  version; the harness must not silently require 3.12+ features the Alpine
  package lacks.
- **`exec()` scenarios are full Python** — acceptable only because scenarios
  are first-party lesson content and run sandboxed; if lesson authoring is
  ever opened to third parties, revisit (Starlark via `starlark-pyo3` is the
  drop-in).
- **`pika.spec` as server-side codec** is unconventional use of a client lib;
  if it fights back, `amqpstorm`'s codec or hand-rolled framing for the ~10
  methods we support is the fallback (S3 answers this early).
