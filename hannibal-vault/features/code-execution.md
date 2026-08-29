# Code Execution (RCE)

Untrusted student code runs in a throwaway Docker container with no network, a read-only filesystem, dropped capabilities, and a hard 30s timeout. **The sandbox lives in a separate service (`rce-service/`), not the backend.** The FastAPI backend keeps the same two HTTP endpoints — a sync one that returns the full result, and an SSE one that streams stdout line-by-line — but fulfils them by talking to the RCE worker over **RabbitMQ**. The frontend is unchanged by the split.

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

Job → `rce.jobs`: `{v, job_id, mode: "sync"|"stream", language, code, emu?}`. `emu` is a lesson's emulator setup — `{services, seed, faults, log_limit}`, emu's own `config.json` (see [emu-service](../reference/emu-service.md)); absent for every request that wants no infrastructure, and such a request runs exactly as it did before emu existed.
Result → reply queue: `{v, job_id, ok, result?: {exec_id, exit_code, stdout, stderr, timed_out, duration_ms, dependency_error, emu_oplog}, error?: {code, message}}`. `emu_oplog` is every operation the code performed against the emulators and which of them were faulted — the artifact a lesson grades *behaviour* from; `null` when the job declared no emulators. A dependency failure is still `ok: true` with `dependency_error` set (`kind: "not_allowed" | "install_failed"`, exit_code −1) → the controller returns **200**, exactly as before. Transport failures are `ok: false` with `error.code ∈ {"saturated","internal"}`.
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
    ├── config.py          RUNTIME (images, cmds, per-lang deps provider), SUPPORTED_LANGS, LIMITS (30s / 192MB / 32 pids)
    ├── docker.py          the sandbox: run_code (blocking) + stream_code (async generator); semaphore(5)
    ├── emu.py             the emulator integration: emu-bin volume, wrapped argv, config, op log split
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

Run container: `network_mode=none`, `read_only=True`, `cap_drop=[ALL]`, `security_opt=[no-new-privileges]`, `user=65534:65534`, `mem_limit`+`memswap_limit`=192MB, `pids_limit=32`, tmpfs `/tmp` 64MB, cache volume mounted **read-only**, resolution env (`PYTHONPATH` / `NODE_PATH`). 30s wall-clock timeout. Output capped at 256KB/stream.

The limits moved from 128MB / 10 pids / 10s when emu landed: a lesson's emulators share the cgroup with the student's process. Measured, in `emu-service/verify-sandbox.sh` — a seeded SQL emulator costs 1.8MB and one task, so the headroom is for the lesson's *data*, not for emu.

Installer (network-ON, cache-RW): package manager only (never student code), install scripts disabled (`pip --only-binary=:all:`, `npm --ignore-scripts`), same lockdown minus network, 120s timeout, concurrency 2. Stamps `<cache>/.installed/<pkg>` markers on success only.

### Cache volumes

Named volumes `rce-cache-python` / `rce-cache-node` (fixed names in `docker-compose.yml`). Mounted **rw** into the installer, **ro** into run containers, and **ro** into the `rce-service` container so `install_queue` can read markers without starting a container.

`emu-bin` is a third fixed-name volume, holding the `emu` binary and mounted **ro** at `/emu` into run containers that declare emulators. It is populated at build time — `just publish-emu`, or the one-shot `emu-publisher` compose service `rce-service` waits on — never by the worker.

### Infrastructure emulators (emu)

A job carrying an `emu` config runs behind `emu`, which takes the container's command slot so the emulators are listening on loopback before the child's first `connect()`:

```
sh -c 'echo <config> | base64 -d > /tmp/emu-config.json &&
       echo <code>   | base64 -d > /tmp/<id>.py &&
       exec /emu/emu run --config /tmp/emu-config.json -- python3 /tmp/<id>.py'
```

Three details that are easy to undo by accident:

- **`exec`** — without it emu is a child of the shell rather than PID 1, and student code sharing uid 65534 could kill the process injecting the faults grading it.
- **The config is written into the tmpfs, not bind-mounted** — rce-service drives the *host* daemon from inside its own container, so a path it can write is not a path that daemon could mount. Safe there because emu reads the file before the child exists.
- **`--dev-control-socket` / `--dev-control-bind` are never passed** — a lesson run has no control channel at all. `tests/test_rce_security_invariants.py` asserts the argv is exactly `run --config <path>`.

The Postgres driver on the allowlist is **`pg8000`**, not psycopg: the run image is Alpine/musl and the installer takes wheels only, while psycopg's binary wheels are manylinux.

Full detail: [`../reference/emu-service.md`](../reference/emu-service.md).

**Adding a language** = a new provider in `deps/registry.py` (+ its image in `config.py`). For a tree-sitter grammar it's just `TreeSitterImportDetector(grammar, query, normalise)`.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `RABBITMQ_URL` | `amqp://guest:guest@localhost:5672/` | Broker both sides connect to. |
| `RCE_RPC_TIMEOUT_SECONDS` | `150` | Backend RPC deadline → 504. Covers cold install + run. |
| `RCE_STREAM_IDLE_TIMEOUT_SECONDS` | `150` | SSE relay idle timeout → synthetic error event. |
| `PREWARM_ON_START` | `false` | Seed caches from allowlists on worker boot (background). |

## Tests

- Backend: `tests/test_rce_controller.py`, `tests/test_run_code_controller.py` (endpoints against a fake `get_rce_client`), `tests/test_rce_gateway_client.py` (RPC/stream/reconnect with mocked aio-pika), gateway misc, and `tests/test_package_search_service.py` / `test_registry_client.py` / `test_rce_packages_controller.py` (package search). 100% coverage gate.
- rce-service: the moved sandbox suite — `test_docker.py`, `test_two_phase.py`, `test_dep_errors.py`, `test_rce_deps.py`, `test_rce_cache.py`, `test_rce_installer.py`, `test_rce_install_queue.py`, `test_rce_security_invariants.py` — plus `test_handlers.py`, `test_contracts.py`, `test_consumer.py`. `tests/integration/test_rce_deps_smoke.py` is a real `import numpy` run gated by `RCE_SMOKE=1`.

## Surprises

- **rce-service runs Docker, not the backend.** The `/var/run/docker.sock` mount lives on `rce-service` now — rooting *that* service roots the host, but the internet-facing API no longer holds the socket. This is the security win of the split.
- **rce-service must stay at one replica.** `install_queue`'s per-language writer lock is in-process. Two replicas could run two `pip`/`npm` writers against one cache volume. Scaling later needs a broker-level single-consumer install queue.
- **The stream never reports a real exit code.** Docker merges stdout+stderr into one log stream, so every line is a `stdout` event; the verdict comes from `run-simple`, not the stream. The terminal `exit` event is only a completion sentinel and is not forwarded to the browser.
- **Output truncation is silent** at 256KB/stream; **no code-side syntax check** (the interpreter's traceback is the teaching signal) — both unchanged from before the split.
- **CodeMirror: never add completions with `autocompletion({ override })`** — it replaces the built-in keyword/snippet sources. Register additively through the language data facet. See `importLinting.ts` / `CodeEditor.tsx`.
- **A student cannot forge the op log.** emu writes its dump after the child exits, so the real one is always the last line of stdout — and rce-service reads only the last line. The split also happens before the 256KB truncation, so a chatty program cannot push the graded artifact out of the result.
- **Nothing authors an `emu` config yet.** The contract, the gateway client, and the worker carry one end to end, but no HTTP endpoint or schema exposes it: a lesson's emulator setup belongs on the build block in Mongo alongside `test_code`, and that is a separate change.
