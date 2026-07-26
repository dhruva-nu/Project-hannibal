# Code Execution (RCE)

Untrusted student code runs in a throwaway Docker container with no network, a read-only filesystem, dropped capabilities, and a hard 10s timeout. **The sandbox lives in a separate service (`rce-service/`), not the backend.** The FastAPI backend keeps the same two HTTP endpoints — a sync one that returns the full result, and an SSE one that streams stdout line-by-line — but fulfils them by talking to the RCE worker over **RabbitMQ**. The frontend is unchanged by the split.

## Why a separate service

Running the sandbox means holding the host Docker socket. Keeping that on the internet-facing API is a liability (rooting the backend roots the host). Extracting it moves the socket onto a worker with no public surface, and lets execution scale on its own load profile. The boundary is clean: the worker is **stateless** — it receives final code + language and returns results/events; it touches no database.

## End-to-end flow

```
BuildPanel → useCourseState.runTests() → services/rce.ts
                                          ├─ streamExecute   (live output)
                                          └─ runSimple       (final pass/fail)
                                                 ↓ HTTP (unchanged)
                              backend controllers (rce_controller / run_code_controller)
                                                 ↓ RabbitMQ
                              RceQueueClient  ──publish rce.jobs──►  rce-service worker
                                             ◄──reply / events────   (Docker sandbox)
```

`run-simple` splices the student's code into the build block's `test_code` (at the literal token `--user-code--`) **in the backend** (it needs the block from MongoDB), then publishes the combined script as an ordinary execute job.

Per-case Mermaid diagrams (happy path, cache warm/cold, dependency errors, streaming, 429/504/503/500, reconnect, run-simple splice) live in [`code-execution-flows/`](./code-execution-flows/) — one `.mmd` each.

## Message topology (backend ⇄ rce-service)

```
                   ┌────────────────────────── RabbitMQ ──────────────────────────┐
backend            │  default direct exchange                                     │       rce-service
POST /execute ─────┼─▶ rce.jobs (durable; x-max-length=20, reject-publish) ───────┼─▶ worker (prefetch=5, ack after reply)
POST /run-simple   │      job msgs: transient, expiration=30s (queued TTL)        │
  await Future ◀───┼── rce.replies.<proc-uuid> (exclusive, auto-delete) ◀─────────┼── result, correlation_id echoed
                   │                                                              │
POST /execute/stream: bind exec.<job_id> on topic exchange rce.events FIRST,      │
  then publish job │      per-job queue (exclusive, auto-delete,                  │
  SSE relay ◀──────┼──────x-expires=120s, x-max-length=4096 drop-head) ◀──────────┼── stdout / … / exit events
                   └──────────────────────────────────────────────────────────────┘
```

- **`rce.jobs`** — durable work queue, `x-max-length: 20` + `x-overflow: reject-publish`. With publisher confirms on, a full queue **nacks** the publish → the backend raises **HTTP 429** (this replaces the old in-process run-semaphore's saturation signal). Job messages are transient with a 30s queued TTL, so a job nobody consumes in time dies instead of running for a client that gave up.
- **Sync RPC** — each backend process declares one exclusive reply queue `rce.replies.<uuid>` at startup and consumes it; a `correlation_id → asyncio.Future` map routes replies. `execute()` awaits with a 150s timeout (`RCE_RPC_TIMEOUT_SECONDS`, sized for a 120s cold install + 10s run) → **504** on timeout. On broker reconnect the in-flight futures are failed fast (never leaked).
- **Streaming** — the worker publishes each event to the `rce.events` topic exchange keyed `exec.<job_id>`; the backend binds the per-job queue **before** publishing (so no early lines are lost) and relays events as SSE until a terminal event. The terminal `exit` event is consumed silently (the frontend never saw one before the split); `error` / `dependency_error` are forwarded then end the stream. An idle gap beyond 150s yields a synthetic `error` event so the browser never hangs.
- **Worker** — `prefetch_count=5` (the old sandbox semaphore cap); acks a job only **after** publishing its reply, so a worker that dies mid-run redelivers — safe, because execution is stateless.

### Message contracts (`v: 1`; pydantic both sides)

Job → `rce.jobs`: `{v, job_id, mode: "sync"|"stream", language, code, infra: []}`. `infra` names the emulators the lesson runs against (see [Infra lessons](#infra-lessons--per-run-emulator-networking)); nothing populates it yet, and empty keeps the sandbox fully network-isolated.
Result → reply queue: `{v, job_id, ok, result?: {exec_id, exit_code, stdout, stderr, timed_out, duration_ms, dependency_error}, error?: {code, message}}`. A dependency failure is still `ok: true` with `dependency_error` set (`kind: "not_allowed" | "install_failed"`, exit_code −1) → the controller returns **200**, exactly as before. Transport failures are `ok: false` with `error.code ∈ {"saturated","internal"}`.
Stream event → `rce.events`: `{v, job_id, event: {...}}` where `event` is exactly the old `events.py` `to_dict()` payload, so SSE frames are byte-compatible.

Backend contracts: `backend/app/services/rce_gateway/contracts.py`. Worker contracts: `rce-service/rce_service/contracts.py` (duplicated by design — separate uv projects).

## Frontend (unchanged)

### Service — `frontend/src/services/rce.ts`

```ts
runSimple(code, language, blockId): Promise<RunSimpleResult>   // POST /api/v1/run-code/run-simple
streamExecute(code, language, onEvent, signal): Promise<void>  // POST /api/v1/rce/execute/stream (SSE)
   // emits RCEEvent: StdoutLine | StderrLine | ExitEvent | ErrorEvent | DependencyErrorEvent
```

`useCourseState.runTests` (`frontend/src/pages/CoursePage/useCourseState.ts:99-128`) fires `streamExecute` (live UI) and `runSimple` (verdict) in parallel via `Promise.allSettled`, then computes `extractRunError` and per-test pass/fail. **It still awaits a synchronous result** — the RPC-over-queue facade preserves that contract.

### Components (unchanged)

| File | Role |
|---|---|
| `shared/components/molecules/CodeEditor/CodeEditor.tsx` | CodeMirror 6 editor (Python, JavaScript, Go). Per-language completion + package intelligence via `languageBundle()`. |
| `shared/components/molecules/CodeEditor/imports.ts` | Pure import-statement parsing. |
| `shared/components/molecules/CodeEditor/importLinting.ts` | Async autocomplete source + existence linter. |
| `shared/components/molecules/RunError/RunError.tsx` | Collapsible badge → modal with the full stderr trace. |
| `shared/components/organisms/BuildPanel/BuildPanel.tsx` | Composes editor, test result list, output stream, Run/Reset/Place. |

Package search/verify (editor autocomplete + red-squiggle) **stayed in the backend** — it needs Postgres (`rce_packages` table) and outbound PyPI/npm HTTP, and has no Docker dependency.

## Backend (the queue gateway)

### Controllers — same routes, same schemas

| Method | Path | Auth | Body | Returns |
|---|---|---|---|---|
| POST | `/rce/execute` | yes | `ExecuteRequest{code, language}` | `ExecuteResponse` |
| POST | `/rce/execute/stream` | yes | `ExecuteRequest` | `text/event-stream` |
| POST | `/run-code/run-simple` | yes | `RunSimpleRequest{code, language, block_id}` | `RunSimpleResponse` |
| GET | `/rce/packages/search` | no | `?language=&q=` | `list[str]` |
| GET | `/rce/packages/verify` | no | `?language=&name=` | `PackageVerifyResponse` |

Error mapping: dependency failure → 200 (payload); saturation → 429; RPC timeout → 504; broker unreachable → 503; unexpected worker fault → 500.

### `backend/app/services/rce_gateway/`

```
rce_gateway/
├── client.py       RceQueueClient: connect/close (lifespan-owned), execute() RPC, stream() event relay, correlation map
├── contracts.py    JobV1 / ResultV1 / EventV1 (backend copy)
├── errors.py       RceSaturated (429) / RceTimeout (504) / RceUnavailable (503) / RceServiceError (500)
├── sse_relay.py    stream_sse(): client events → "data: …\n\n" frames, transport error → one error frame
└── test_code.py    add_test_code(): the --user-code-- splice (needs BuildBlockService / Mongo)
```

- The client is created and connected in the FastAPI **lifespan** (`app/main.py`) and stored on `app.state.rce_client`; controllers depend on it via `app/dependencies/rce.py::get_rce_client`, so tests override it with a fake.
- Config: `RABBITMQ_URL`, `RCE_RPC_TIMEOUT_SECONDS`, `RCE_STREAM_IDLE_TIMEOUT_SECONDS` in `app/core/config.py`.

### Package search (stayed) — `backend/app/services/package_search/`

`package_search_service.py` (prefix search + existence verify), `registry_client.py` (PyPI/npm/crates existence checks with TTL cache), `package_meta.py` (frozen language metadata: `SUPPORTED_LANGS`, per-language stdlib set, import→distribution map). `package_meta` replaces the `DepsProvider` objects the backend used to import, letting it drop the `docker` and `tree-sitter` dependencies. Backed by Postgres `rce_packages` (`RcePackageRepository`).

## rce-service (the sandbox worker)

```
rce-service/
├── pyproject.toml / Dockerfile   # py3.14 + uv; aio-pika, docker, tree-sitter; CMD → python -m rce_service.main
└── rce_service/
    ├── main.py            connect_robust, declare topology, consume; optional prewarm; SIGTERM drain
    ├── settings.py        RABBITMQ_URL, prefetch, PREWARM_ON_START; queue/exchange names
    ├── contracts.py       JobV1 / ResultV1 / EventV1 (worker copy)
    ├── consumer.py        declare_topology + make_handler: dispatch by mode, publish reply/events, ack after
    ├── handlers.py        handle_sync() / handle_stream(): two_phase → docker sandbox → result/events
    ├── exceptions.py      UnsupportedLanguage / UnpermittedDependency / DependencyInstallError (moved here)
    ├── config.py          RUNTIME (images, cmds, per-lang deps provider), SUPPORTED_LANGS, LIMITS (10s / 128MB / 10 pids), INFRA_EMULATORS / INFRA_LIMITS / CONTROL_PORT
    ├── docker.py          the sandbox: run_code (blocking) + stream_code (async generator); semaphore(5)
    ├── infra.py           per-run emulator networking: two internal networks, static-IP control plane, teardown
    ├── two_phase.py       prepare_dependencies: resolve imports → allowlist → install_queue.ensure
    ├── installer.py       network-ON installer container (package manager only, scripts disabled, cache RW)
    ├── install_queue.py   cold-path gate: marker lookup, in-flight dedupe, per-language writer lock
    ├── dependency_errors.py  typed failures → {package, reason, kind} payloads
    ├── result.py          output truncation (256KB/stream) + result packaging
    ├── events.py          stdout/stderr/exit/error/dependency_error dataclasses (.to_dict())
    ├── prewarm.py         `python -m rce_service.prewarm` — seed caches from the allowlists
    └── deps/              per-language providers: provider, registry, python (ast), javascript (tree-sitter), treesitter, cache
```

### Sandbox posture (both phases, unchanged by the move)

Run container: `network_mode=none`, `read_only=True`, `cap_drop=[ALL]`, `security_opt=[no-new-privileges]`, `user=65534:65534`, `mem_limit`+`memswap_limit`=128MB, `pids_limit=10`, tmpfs `/tmp` 64MB, cache volume mounted **read-only**, resolution env (`PYTHONPATH` / `NODE_PATH`). 10s wall-clock timeout. Output capped at 256KB/stream.

Installer (network-ON, cache-RW): package manager only (never student code), install scripts disabled (`pip --only-binary=:all:`, `npm --ignore-scripts`), same lockdown minus network, 120s timeout, concurrency 2. Stamps `<cache>/.installed/<pkg>` markers on success only.

### Cache volumes

Named volumes `rce-cache-python` / `rce-cache-node` (fixed names in `docker-compose.yml`). Mounted **rw** into the installer, **ro** into run containers, and **ro** into the `rce-service` container so `install_queue` can read markers without starting a container.

**Adding a language** = a new provider in `deps/registry.py` (+ its image in `config.py`). For a tree-sitter grammar it's just `TreeSitterImportDetector(grammar, query, normalise)`.

## Infra lessons — per-run emulator networking

Issue #133 / Phase 0b of [`plans/infra-emulators.md`](../../plans/infra-emulators.md). Lessons that teach infrastructure need the student container to reach a [cannae-service](../../cannae-service/README.md) emulator — and nothing else. A job whose `infra` list is non-empty gets a two-network topology built for that run and destroyed with it. **A job with an empty `infra` list never touches this code and keeps `network_mode="none"` byte for byte.**

```
  student container ──[ cannae-sbx-<run> : internal ]── cannae container
                                                              │
  rce-service (harness) ─[ cannae-ctl-<run> : internal ]──────┘
                                                    static IP, :9900
```

`rce_service/infra.py` owns the whole lifecycle:

| Function | Role |
|---|---|
| `resolve_infra(infra)` | `INFRA_EMULATORS` lookup → `(network aliases, student env vars)`. Unknown emulator or two emulators on one hostname → `InfraUnavailable`. |
| `start_session(infra)` | Both networks, the emulator container, the alias attach, and the readiness wait. Any failure unwinds everything before re-raising. |
| `stop_session(session)` | Container + both networks, detaching leftover endpoints first. Never raises. |
| `infra_session(infra)` | Async context manager `handlers.py` wraps each job in; `None` when no infra. Docker calls go to a thread. |

**Why the control plane is on its own network.** The emulator control API (`/seed`, `/reset`, `/log`, `/faults`, `/state`) is the graded state. If a student could reach it they could reset their own run. So the emulator gets a **static IP** on a harness-only network (`ipv4_address` out of a per-run `/29` carved from `10.99.0.0/16`) and the binary is started with `--control-bind <that ip>:9900` — `:9900` is not listening on any interface the student can route to. Binding `0.0.0.0` on a two-network container would expose it on the sandbox network; that must never happen.

**How the harness reaches it.** In production `rce-service` is itself a container, so `start_session` finds its own id in `/proc/self/mountinfo` and joins the harness network. On a bare host (dev, CI) the bridge is already routable and nothing is attached.

**What the student sees.** Ordinary connection strings on ordinary hostnames, exactly like a real deployment — `ECHO_URL=tcp://echo:7777`, `DATABASE_URL=postgresql://…@db:5432/app`, `REDIS_URL=redis://cache:6379`, `MONGO_URL=mongodb://db:27017/app`, `AMQP_URL=amqp://…@queue:5672/`. The hostnames are network aliases on the emulator container. `echo`, `redis` and `postgres` have backing emulators today ([cannae-service](../../cannae-service/README.md)); `mongo` and `amqp` are the locked contract Phases 3–4 fill in.

A caching lesson declares `infra: ["redis"]` and the student writes ordinary `redis://cache:6379` code against a RESP2 emulator whose clock, expiry, and stale reads the harness scripts — see [Phase 1](../../plans/infra-emulators.md#3-phase-1--cache-redis-resp2--shipped-134-cratescannae-cache). A transactions lesson declares `infra: ["postgres"]` and the student writes ordinary `psycopg2` / SQLAlchemy / node-postgres code against a wire-protocol-v3 emulator whose mid-transaction crashes and retryable errors the harness scripts — see [Phase 2](../../plans/infra-emulators.md#4-phase-2--sql-postgres-wire-protocol-v3--shipped-135-cratescannae-sql). Every statement is logged with the transaction state it ran under, so "did the student wrap both writes in a transaction" is an op-log assertion rather than a guess. Lesson-declared env is applied **before** the deps provider's, so nothing can shadow `PYTHONPATH` / `NODE_PATH`.

**Emulator container posture.** Same lockdown as the student sandbox — `cap_drop=[ALL]`, `no-new-privileges`, `user=65534:65534`, `read_only=True`, 128MB, `pids_limit=64` — minus the tmpfs: it is a `FROM scratch` static binary that writes nothing. The image is never pulled; a missing `cannae-service:latest` is a loud `InfraUnavailable`.

Every object created carries the label `com.hannibal.cannae=run`, so leftovers from a hard-killed worker are one `docker network prune --filter` away.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `RABBITMQ_URL` | `amqp://guest:guest@localhost:5672/` | Broker both sides connect to. |
| `RCE_RPC_TIMEOUT_SECONDS` | `150` | Backend RPC deadline → 504. Covers cold install + run. |
| `RCE_STREAM_IDLE_TIMEOUT_SECONDS` | `150` | SSE relay idle timeout → synthetic error event. |
| `PREWARM_ON_START` | `false` | Seed caches from allowlists on worker boot (background). |
| `CANNAE_IMAGE` | `cannae-service:latest` | The emulator image infra lessons run. Built locally from `cannae-service/`, never pulled. |

## Tests

- Backend: `tests/test_rce_controller.py`, `tests/test_run_code_controller.py` (endpoints against a fake `get_rce_client`), `tests/test_rce_gateway_client.py` (RPC/stream/reconnect with mocked aio-pika), gateway misc, and `tests/test_package_search_service.py` / `test_registry_client.py` / `test_rce_packages_controller.py` (package search). 100% coverage gate.
- rce-service: the moved sandbox suite — `test_docker.py`, `test_two_phase.py`, `test_dep_errors.py`, `test_rce_deps.py`, `test_rce_cache.py`, `test_rce_installer.py`, `test_rce_install_queue.py`, `test_rce_security_invariants.py` — plus `test_handlers.py`, `test_infra.py`, `test_contracts.py`, `test_consumer.py`. 100% coverage gate (`.github/workflows/rce-service.yml`; `main.py` is omitted — it is the process entrypoint).
- Gated integration tests (real Docker): `tests/integration/test_rce_deps_smoke.py` is a real `import numpy` run behind `RCE_SMOKE=1`. `tests/integration/test_infra_isolation.py` is the **Phase 0b acceptance gate** behind `RCE_INFRA_SMOKE=1` — it runs a probe *inside a student container* proving the emulator answers by hostname, a `kill_connection` fault fires mid-conversation, and `:9900` is unreachable by hostname, by harness IP, and by sandbox IP, along with no neighbouring run, no internet, and no DNS. It runs in CI (`infra-isolation` job), which also fails the build if any labelled network or container survives teardown.

## Surprises

- **rce-service runs Docker, not the backend.** The `/var/run/docker.sock` mount lives on `rce-service` now — rooting *that* service roots the host, but the internet-facing API no longer holds the socket. This is the security win of the split.
- **rce-service must stay at one replica.** `install_queue`'s per-language writer lock is in-process. Two replicas could run two `pip`/`npm` writers against one cache volume. Scaling later needs a broker-level single-consumer install queue.
- **The stream never reports a real exit code.** Docker merges stdout+stderr into one log stream, so every line is a `stdout` event; the verdict comes from `run-simple`, not the stream. The terminal `exit` event is only a completion sentinel and is not forwarded to the browser.
- **`--control-bind` is a security control, not a convenience flag.** The emulator sits on two networks. Left at its `0.0.0.0` default it would listen on the sandbox interface too, and a student could `POST /reset` their own graded state. `infra.py` always passes the harness IP; `test_infra_isolation.py` probes all three routes from inside a student container to prove it.
- **Output truncation is silent** at 256KB/stream; **no code-side syntax check** (the interpreter's traceback is the teaching signal) — both unchanged from before the split.
- **CodeMirror: never add completions with `autocompletion({ override })`** — it replaces the built-in keyword/snippet sources. Register additively through the language data facet. See `importLinting.ts` / `CodeEditor.tsx`.
