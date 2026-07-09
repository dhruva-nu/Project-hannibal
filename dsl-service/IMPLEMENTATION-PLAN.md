# Implementation plan — #126: DSL v1 schema + per-target emitters

> Plan only — not yet implemented. Umbrella issue: #51. This covers sub-issue #126 (the Rust dsl-service). Backend (#127), RCE Java (#128), and frontend (#129) are out of scope here.

## Context

Course creators author each build block once in a language-neutral DSL (template + test harness); this service translates it to the learner's chosen `(language, library)` target. The service today is a 50-line stub: `POST /translate {dsl, language} → {code}` with a Python passthrough and zig/go placeholders. Everything gets replaced except the axum skeleton.

## Agreed design (from #51/#126)

- DSL v1: YAML, `kind: function | http_endpoint`, versioned via `dsl_version: 1`.
- Targets v1: `function` × python/plain, javascript/plain, java/plain; `http_endpoint` × python/fastapi, python/flask, javascript/express.
- Two artifacts per target: `template` (learner starter code) and `harness` (contains `--user-code--` splice token).
- Harness protocol: test cases embedded as literals; one execution runs all tests; in-language value comparison; one JSON line per test on stdout: `{"name", "passed", "actual"}` (+ `"error"` when the learner code throws — a per-test try/catch so one failure doesn't kill the run).
- Module layout: language folder → lib-category folder (`web_frameworks/` only for v1) → library module; `plain.rs` at language level.
- Invalid DSL → structured errors `{field, reason}`, never free text.

## Implementation steps

### 1. Dependencies (`Cargo.toml`)

- Add `serde_norway` (maintained drop-in fork of the archived `serde_yaml`) for YAML parsing. The fork matters because CI runs `cargo audit` (`.github/workflows/dsl-service.yml` security job) and the archived `serde_yaml` carries an unmaintained advisory. If `serde_norway` proves problematic at build time, fall back to `serde_yaml = "0.9"` and verify `cargo audit` still exits 0.
- Dev-deps for HTTP tests: `tower` (for `ServiceExt::oneshot`), `http-body-util`.
- Toolchain: edition 2024, Dockerfile builds on `rust:1.93-alpine`, CI uses `stable`. `Cargo.lock` is committed; keep the updated lockfile in the PR.

### 2. `src/dsl/` — parse + validate

- `types.rs`:
  - `Dsl { dsl_version: u32, #[serde(flatten)] block: Block }`
  - `enum Block` — `#[serde(tag = "kind", rename_all = "snake_case")]`: `Function { name, params: Vec<Param>, returns: Type, tests: Vec<FnTest> }`, `HttpEndpoint { method, path, response: HttpShape, tests: Vec<HttpTest> }`
  - `enum Type { Int, Float, Str, Bool, List(Box<Type>) }` — custom `Deserialize` from strings `"int" | "float" | "str" | "bool" | "list<T>"`
  - `FnTest { name, input: Vec<serde_json::Value>, expected: serde_json::Value }`; `HttpTest { name, request { method, path, body? }, expected { status, body? } }`
  - `ValidationError { field: String, reason: String }` (serializable)
- `mod.rs`: `parse(&str) -> Result<Dsl, Vec<ValidationError>>` — serde error mapped to one error (with YAML location in `field`), then `validate.rs` semantic pass collects **all** errors:
  - `dsl_version == 1`; `name` is a valid snake_case identifier; unique param names; test `input` arity == params len; test input/expected values type-check against declared `Type`s; http `path` starts with `/`; known `method`; non-empty `tests`.

### 3. `src/codegen/` — scaffolding

- `target.rs`: `Target { language: String, library: String }` (serde).
- `mod.rs`:
  - `trait Emitter { fn template(&self, dsl: &Dsl) -> String; fn harness(&self, dsl: &Dsl) -> String; }`
  - Single static registry table (the one-entry-per-target extension point): `registry() -> &'static [(Kind, Target, &'static dyn Emitter)]` via `OnceLock`; `emitter_for(kind, &target) -> Option<&dyn Emitter>`; `supported_targets(kind) -> Vec<Target>` derived from the table.
- `render.rs` (shared helpers): `py_literal(&Value)`, `js_literal(&Value)`, `java_literal(&Value, &Type)` (typed, since Java has no stdlib JSON), `snake_to_camel(&str)` for JS/Java identifiers, and a small indent/join util. Emitters format code with these — no templating crate.

### 4. Plain emitters (`kind: function`)

- `python/plain.rs` — template: `def {name}({params with type hints}) -> {ret}:\n    # your code here`. Harness: `import json` → `--user-code--` → literal `_TESTS` list → loop with per-test `try/except`, compare `actual == expected` (values, not strings), `print(json.dumps({...}))`.
- `javascript/plain.rs` — template: `function {camelName}(...) {}`. Harness: same shape with `try/catch` + `JSON.stringify`; deep-equality helper emitted inline for list results.
- `java/plain.rs` — single-file contract: template is a **non-public** `class Solution { static {ret} {name}(...) { ... } }`; harness appends `public class Main { public static void main(...) }` with typed literal calls and an emitted `printResult` helper doing manual JSON escaping. Exact `==`/`.equals` comparison (exact double equality is acceptable v1; documented). **Coupling to flag in the PR:** the emitted public class is `Main`, so #128 must write the file as `Main.java`.

### 5. Web-framework emitters (`kind: http_endpoint`)

- `python/web_frameworks/fastapi.rs` — template: `from fastapi import FastAPI` + `app = FastAPI()` + route stub from DSL. Harness: splice → `TestClient(app)` → literal requests → compare `status_code` and parsed-JSON body → result lines. (Sandbox needs `fastapi` + `httpx` allowlisted — #127 note, already in the issue.)
- `python/web_frameworks/flask.rs` — same via `app.test_client()`.
- `javascript/web_frameworks/express.rs` — learner template creates `app` without `listen`; harness starts `app.listen(0)`, drives it with Node's built-in `fetch` against the ephemeral port, closes the server. This avoids a `supertest` dependency — only `express` itself needs allowlisting.

### 6. HTTP API (`src/main.rs` + new `src/http.rs`)

- `POST /validate {dsl}` → `200 {kind, supported_targets: [{language, library}]}` | `422 {errors: [...]}`
- `POST /translate {dsl, language, library = "plain", artifact = "template" | "harness"}` → `200 {code}` | `422` (invalid DSL) | `400 {error}` (unsupported target for the kind)
- `GET /targets?kind=` → `{targets: [...]}`
- **Legacy passthrough shim**: if the `dsl` payload has no `dsl_version:` key, `/translate` with `artifact=template` returns the input unchanged — exactly today's prod behavior for existing raw-Python blocks, so the current backend keeps working until #127 stops calling translate for legacy blocks. Marked `TODO(#127)`.
- `main.rs` stays thin (router + listener); handlers in `http.rs`; error enum implementing `IntoResponse`.

### 7. Tests

- Unit tests inline per module: type parsing, every validation rule (one failing fixture each), registry lookups.
- Emitter snapshot tests: full expected outputs as fixture files under `tests/fixtures/` loaded with `include_str!` — one template + one harness fixture per (kind × target), driven from two canonical DSL docs (the `divide` function and the `/health` endpoint from #51).
- HTTP integration tests (`tests/http.rs`): `tower::ServiceExt::oneshot` against the router — happy paths, 422 shape, 400 unsupported target, legacy passthrough.
- `tests/exec_smoke.rs`, env-gated (`DSL_EXEC_SMOKE=1`): emit harness + a correct solution, run via `python3`/`node` with `std::process::Command`, assert every result line has `"passed": true`. Java leg additionally gated on `javac` being present.

### 8. Docs

- `dsl-service/DSL.md` — the DSL v1 spec: kinds, type vocabulary, both examples, harness protocol, how to add a target (emitter module + registry row).
- Vault: no dedicated dsl-service note exists today (only scattered references). Add one (e.g. `hannibal-vault/reference/dsl-service.md`, matching wherever per-service notes live) documenting the module layout, endpoints, and DSL spec pointer. The legacy passthrough shim preserves current behavior, so existing references stay accurate; `features/courses-and-lessons.md` updates belong to #127.

## Branching / commits

New branch `feat/126-dsl-service` off `main`. Conventional commits, `feat(dsl-service): ...`.

## Verification

The repo already has the exact gates CI enforces (`.github/workflows/dsl-service.yml`), mirrored as just recipes:

1. `just test-dsl` (`cargo test --all-features`) — unit + snapshot + HTTP tests green (CI currently runs zero tests; this PR is the first real suite).
2. `just lint-dsl` (`cargo clippy --all-targets --all-features -- -D warnings`) and `just fmt-check-dsl`.
3. `just security-dsl` (`cargo audit`) — confirms the YAML crate choice is clean.
4. `DSL_EXEC_SMOKE=1 cargo test --test exec_smoke` (python3 + node available locally) — emitted harnesses actually execute and every result line reports `"passed": true`.
5. Run the service (`just dev-dsl`) and curl the three endpoints with the two canonical DSL docs — verify `{code}` output, 422 error shape, `/targets` list, and legacy passthrough.
6. Backend regression: no backend changes in this PR, and translate failures on lesson open are only console-logged in the FE (`CoursePage.tsx:74-92`), but still hit `GET /api/v1/build-blocks/{id}/translate?language=python` against a legacy block with the service running to confirm the passthrough shim preserves today's behavior end-to-end.
