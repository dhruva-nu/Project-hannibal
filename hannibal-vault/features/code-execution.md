# Code Execution (RCE)

Untrusted student code runs in a throwaway Docker container with no network, a read-only filesystem, dropped capabilities, and a hard 10s timeout. Two endpoints: a sync one that returns the full result, and an SSE one that streams stdout/stderr line-by-line.

## End-to-end flow

```
BuildPanel  →  useTestExecution.runTests()  →  services/rce.ts
                                                ├─ streamExecute   (live output)
                                                └─ runSimple       (final pass/fail)
                                                       ↓
                                          POST /api/v1/run-code/run-simple
                                                       ↓
                                          run_code_controller.run_simple
                                                       ↓
                                          rce.run_simple                       (services/rce/run_simple.py)
                                            ├─ add_test_code(code, block)      (runners/simple.py)
                                            │     splices code into test_code at "--user-code--"
                                            ├─ SimpleRunner.stream             → docker.run_code()
                                            │                                    Docker container, 10s timeout
                                            └─ assemble {exit, stdout, stderr, timed_out, duration_ms}
```

## Frontend

### Service — `frontend/src/services/rce.ts:20-59`

```ts
runSimple(code, language, blockId): Promise<RunSimpleResponse>
   → POST /api/v1/run-code/run-simple

streamExecute(code, language, onEvent): Promise<void>
   → POST /api/v1/rce/execute/stream  with EventSource-style chunked parsing
   → emits RCEEvent union: StdoutLine | StderrLine | ExitEvent | ErrorEvent
```

### Components

| File | Role |
|---|---|
| `shared/components/molecules/CodeEditor/CodeEditor.tsx` | CodeMirror 6 editor. Languages: Python, JavaScript, Go. Props: `{ value, language, onChange }`. Wires per-language completion + package intelligence via `languageBundle()`. |
| `shared/components/molecules/CodeEditor/imports.ts` | Pure import-statement parsing: `importCompletionSpot()` (where the cursor is typing a package) + `listImportedPackages()` (every imported package with its range), Python & JS. |
| `shared/components/molecules/CodeEditor/importLinting.ts` | Package intelligence: async autocomplete source (`importCompletionSource`), pending spinner widget, and the existence `linter` (red squiggle). `packageIntelligence(lang)` returns the bundle. |
| `shared/components/molecules/RunError/RunError.tsx:9-34` | Collapsible badge that opens a modal with the full stderr trace. |
| `shared/components/organisms/BuildPanel/BuildPanel.tsx:49-146` | Composes the editor, test result list, output stream, and Run/Reset/Place buttons. |

### Hook — `frontend/src/pages/CoursePage/useTestExecution.ts:33-78`

```ts
initBuildTests(blockId)     // GET /build-blocks/{id} → seeds state.testResults with {pass: null}
runTests(code, language)    // fires streamExecute (live UI) + runSimple (verdict) in parallel
                            // parses ✓/✗ lines, updates per-test pass/fail
                            // all-pass → unlocks "Place on board"
```

## Backend

### Controllers

#### `rce_controller.py:19-70`

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/rce/execute` | `ExecuteRequest{code, language}` | `ExecuteResponse{exec_id, language, exit_code, stdout, stderr, timed_out, duration_ms}` |
| POST | `/rce/execute/stream` | `ExecuteRequest` | `text/event-stream` of `StdoutLine` / `StderrLine` / `ExitEvent` / `ErrorEvent` |

#### `run_code_controller.py:15-47`

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/run-code/run-simple` | `RunSimpleRequest{code, language, block_id}` | `RunSimpleResponse` (same as ExecuteResponse + block_id) |

`run-simple` is the test-execution path used by build lessons. It fetches the build block by `block_id`, splices the student's code into the block's `test_code` (at the literal token `--user-code--`), and runs the combined script.

### Service layer — `backend/app/services/rce/`

```
services/rce/
├── __init__.py           re-exports
├── config.py             runtime images, supported langs, limits, per-lang deps provider
├── deps/                 per-language dependency providers (import detection + allowlist)
│   ├── provider.py       ImportDetector Protocol + DepsProvider abstraction
│   ├── treesitter.py     generic grammar-based detector (JS now; C++/Java later)
│   ├── python.py         ast-based detector + Python provider
│   ├── javascript.py     tree-sitter query + specifier normaliser + JS provider
│   ├── cache.py          global package-cache volumes: ensure/create, RW vs RO mount specs, prewarm list
│   └── registry.py       DEPS_PROVIDERS (language → provider)
├── docker.py             the sandbox itself
├── installer.py          network-ON installer container: package manager only, scripts disabled, cache RW
├── install_queue.py      cold-path gate: marker lookup, in-flight dedupe, single writer per volume
├── two_phase.py          prepare_dependencies: resolve → ensure cache, in front of every run path
├── prewarm.py            `python -m app.services.rce.prewarm` — seed caches from the allowlists
├── events.py             dataclass events for the stream
├── result.py             output truncation + result packaging
├── run_simple.py         orchestrator used by /run-code
└── runners/
    ├── base.py           Protocol: stream(code, language) → AsyncGenerator[Event]
    └── simple.py         add_test_code splicing + SimpleRunner
```

#### `config.py:1-33`

```python
RUNTIME = {
  "python":     {"image": "python:3.11-alpine", "cmd": ["python", "-u", "/app/main.py"]},
  "javascript": {"image": "node:20-alpine",     "cmd": ["node", "/app/main.js"]},
}
SUPPORTED_LANGS = {"python", "javascript"}
LIMITS = {
  "timeout_seconds": 10,
  "memory_mb":       128,
  "pids":            10,
}
```

#### `docker.py:43-200`

The sandbox. Two entry points:

- `run_code(code, language)` — synchronous, blocking. Capped at 5 concurrent runs via a semaphore.
- `stream_code(code, language)` — async generator. Spawns a thread that pumps container logs into a line buffer; yields each line as soon as it's seen.

Both entry points are fronted by `two_phase.prepare_dependencies(code, language)` (called by the controllers and `run_simple`): resolve imports → allowlist check → `install_queue.ensure` → only then start the run container. The run container itself gains exactly two dependency-related settings — `volumes=run_phase_mounts(provider)` (the cache, **read-only**) and `environment=provider.runtime_env` — everything below is unchanged.

Container settings (both paths):

| Setting | Value |
|---|---|
| `cap_drop` | `["ALL"]` |
| `network_mode` | `"none"` |
| `read_only` | `True` |
| `tmpfs` | `{"/tmp": "size=64m"}` |
| `mem_limit` | `"128m"` |
| `pids_limit` | `10` |
| `auto_remove` | `True` |
| timeout | 10 s wall-clock |

Output is capped by `result._truncate` at **256 KB** per stream.

#### `runners/simple.py:17-42`

```python
add_test_code(code, build_block):
    if "--user-code--" not in build_block.test_code:
        raise TestCodeSyntaxFailure(...)
    return build_block.test_code.replace("--user-code--", code)

class SimpleRunner:
    async def stream(code, language):
        # runs run_code in an executor, yields stdout line, stderr line, exit event
```

#### `deps/` — dependency providers (SUB1 of #103)

The language-agnostic hook for third-party imports. Each language gets one `DepsProvider` (in `deps/registry.py`), attached to its `RUNTIME` entry as `RUNTIME[lang]["deps"]`. A provider carries:

| Field | Purpose |
|---|---|
| `allowlist` | curated packages permitted for this language (python: numpy/pandas/requests/bcrypt; javascript: axios/bcrypt/lodash) |
| `detector` | an `ImportDetector` — `code → [import names]`. **Real parsers, no regex:** Python uses stdlib `ast`; JS uses the tree-sitter grammar via the reusable `TreeSitterImportDetector` |
| `stdlib` | modules never treated as deps (Python `sys.stdlib_module_names`; a Node built-ins set) |
| `import_to_package` | import→distribution name map for the cases they differ (`cv2`→`opencv-python`, …) |
| `cache_volume`, `cache_path`, `runtime_env` | the global package cache: named Docker volume, its mount point inside containers, and the resolution env (`PYTHONPATH=/opt/rce-cache/python`; `NODE_PATH=/opt/rce-cache/node/node_modules`) |

Two methods:
- `dependencies(code)` → third-party packages, stdlib-filtered, name-mapped, de-duped.
- `resolve(code)` → same, but raises `UnpermittedDependency(package, language)` on the first package not in the allowlist. This is the guard the executor will call before running.

##### Cache volumes (SUB2 of #103)

`deps/cache.py` owns the pnpm-store-style global cache. One named volume per language (`rce-cache-python`, `rce-cache-node`, declared with fixed names in `docker-compose.yml`), created lazily by `ensure_cache_volume`. The mount posture is the security contract: `install_phase_mounts` (installer, network-on phase) binds it **rw**; `run_phase_mounts` (untrusted student code) binds it **ro**. `prewarm_packages` returns the allowlist — it doubles as the cache seed list.

##### Sandboxed installer (SUB3 of #103)

`installer.py` is the only writer of the cache and the only network-ON container this service starts. Invariants: it runs **the package manager only** (command built from the provider's `install_cmd` + re-checked allowlist — student code never enters this phase); install scripts are disabled (`pip --only-binary=:all:`, `npm --ignore-scripts`); cap-drop ALL, `no-new-privileges`, user nobody, read-only rootfs except the RW cache mount + tmpfs; **no Docker socket**. Own timeout (120s) and concurrency cap (2), separate from the run semaphore. On success it stamps `<cache>/.installed/<pkg>` markers (`&&`-guarded, so a failed install never marks); the SUB4 queue reads them. `DependencyInstallError` in `rce_exception.py` carries `{packages, language, reason}`.

##### Install queue (SUB4 of #103)

`install_queue.py` gates the cold path. Cache hit (in-process record or a `.installed/<pkg>` marker — the backend has each cache volume mounted read-only via compose) skips the queue entirely. On a miss: **in-flight dedupe** (N concurrent requests for the same package await one install job), a **per-language writer lock** (pip/npm mutate shared store files, so each volume has exactly one writer at a time), and clean failure (a failed job is forgotten so the next request retries; markers only come from successful installs). `dep_set_hash` gives a stable, order/duplicate-insensitive identity for a dependency set. Singleton: `install_queue`.

**Adding a language** = a new provider in `registry.py`. If tree-sitter has its grammar (C++, Java, Go all do), the detector is just `TreeSitterImportDetector(grammar, query, normalise)` — a query + a specifier→package function, no new parsing code. The orchestrator never changes.

#### `run_simple.py:9-38`

```python
async def run_simple(code, language, block_id):
    block = await build_block_service.get_block(block_id)
    combined = add_test_code(code, block)
    runner = SimpleRunner()
    async for event in runner.stream(combined, language):
        ...  # accumulate stdout, stderr, exit_code
    return RunSimpleResponse(...)
```

### Schemas — `backend/app/schemas/`

| File | Models |
|---|---|
| `rce.py:4-16` | `ExecuteRequest`, `ExecuteResponse` |
| `run_code.py:6-20` | `RunSimpleRequest`, `RunSimpleResponse` |

### Exceptions — `backend/app/exception/`

| Class | File | When |
|---|---|---|
| `UnsupportedLanguage` | `rce_exception.py:1-7` | `language` not in `SUPPORTED_LANGS`. |
| `UnpermittedDependency` | `rce_exception.py:10-19` | Code imports a package not on the language's allowlist (`DepsProvider.resolve`). |
| `TestCodeSyntaxFailure` | `dsl/errors.py:4-11` | Build block's `test_code` is missing the `--user-code--` placeholder. |

### DSL side-car

A separate service running on port 9000 (`docker-compose.yml`, image built from `dsl-service/`). It translates the abstract build-block template into language-specific source. The BE calls it from `services/dsl_service.py` when a FE asks for `GET /build-blocks/{id}/translate?language=…`. The DSL service is otherwise unrelated to code execution; both happen to be part of the build-lesson workflow.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `DSL_SERVICE_URL` | `http://localhost:9000` (dev), `http://dsl-service:9000` (compose) | Where to call the translator. |
| — | — | Docker socket is mounted into the backend container (`/var/run/docker.sock`). |

## Surprises

- **The backend runs Docker.** The `backend` container has the host's Docker socket mounted, so when it spawns the sandbox it's actually using the host's Docker daemon. This is a deliberate trade-off — a true sibling-container model — but means **rooting the backend roots the host**. Not safe to deploy as-is on a multi-tenant host.
- **No code-side syntax check.** Bad Python gets sent straight to the container; the student sees the interpreter's traceback in stderr. This is intentional — it's part of the learning loop.
- **Output truncation is silent.** If the student's program prints > 256 KB, the rest is dropped without warning. Watch for `len(stdout) === 256 * 1024` if you're debugging cut-off output.
- **`run-simple` runs the entire combined script.** Tests aren't isolated per case — the `test_code` is responsible for printing `✓` / `✗` lines that the FE parses (`parseTestOutput` in `useTestExecution.ts`). Adjust the block's `test_code` to change test reporting format.
- **CodeMirror: never add completions with `autocompletion({ override })`.** `override` *replaces every completion source*, so it silently kills the language's built-in keyword/snippet completions (`def`, `if`, `while`, builtins). To add a source **additively**, register it through the language's data facet — `support.language.data.of({ autocomplete: mySource })` — and use `autocompletion({ activateOnTyping: true })` with no `override`. The custom sources then merge with the built-ins. This is how `languageBundle()` in `CodeEditor.tsx` wires `featureSource` + `importCompletionSource`. (Regression history: `override` once wiped keyword completion; the data-facet approach fixed it.)
- **The package linter needs `needsRefresh`.** The existence verdict arrives asynchronously (a `setStatus` effect), not as a document edit, so `linter(..., { needsRefresh })` must re-run on that effect or the red squiggle won't appear until the next keystroke. See `importLinting.ts`.
