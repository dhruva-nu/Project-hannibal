# cannae-service

Protocol-level infrastructure emulators — students write real code with real client
libraries against what they believe is Postgres / Redis / RabbitMQ / MongoDB, but is
actually a deterministic, instrumented emulator we fully control.

Full rationale: [`../current-problem.md`](../current-problem.md). Plan and phases:
[`../plans/infra-emulators.md`](../plans/infra-emulators.md).

## Phase 0 (this crate set)

The shared kit every emulator sits on, plus a trivial **echo** emulator that proves it:

- `crates/emu-core` — connection front, operation log, fault engine, control plane.
- `crates/emu-echo` — the proving emulator, built entirely on `emu-core`.
- `crates/cannae` — the binary: parses run config, starts declared emulators.

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
{ "emulator": "echo", "action": "kill_connection",
  "after": { "op_matches": "ECHO", "count": 1 }, "times": 1, "conn": "any", "params": {} }
```

## Run it

```sh
cargo run -p cannae -- --infra echo --control-bind 127.0.0.1:9900
# echo listens on :7777, control API on :9900
printf 'hello\n' | nc 127.0.0.1 7777
```

## Test

```sh
cargo test              # unit tests + the echo end-to-end acceptance test
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
```

## Build the static image

```sh
docker build -t cannae-service .   # FROM scratch, fully static musl binary
```
