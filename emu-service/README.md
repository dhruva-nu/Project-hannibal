# emu-service

A single static Go binary that runs inside the existing no-network code execution
container and serves infrastructure emulators — a SQL DB, cache, queue, and
document DB — on loopback, behind a control layer that can make any operation
fail on demand.

Plan and phase breakdown: [`../plans/emu-service.md`](../plans/emu-service.md)

## Current state — P0 supervisor, P1 control core

The supervisor and the control layer every emulator will sit behind. No protocol
code yet, so nothing binds a port and nothing calls `Before` — P3 hands the
interceptor to the first emulator.

```
emu run [flags] -- <command> [args...]   run <command>, supervised
emu ctl <command> --socket <path>        drive a locally-running emu (dev only)
emu help                                 show usage
```

## Why emu starts the child

A container runs exactly one command, so `emu` takes that slot and starts the
student's process itself:

```
# today
python3 -u /tmp/app.py

# once P7 lands
/emu/emu run --config /emu/config.json -- python3 -u /tmp/app.py
```

Backgrounding `emu` alongside the child instead would break in four ways, which
is what P0 exists to settle:

- **Startup race.** The child can `connect(5432)` before the emulators are bound.
  `emu` binds every port before spawning, and nothing else can guarantee that.
- **Exit code.** The platform grades on it; a shell wrapper reports its own.
- **Zombies.** As PID 1 `emu` inherits orphaned grandchildren, and an unreaped
  zombie holds a slot against the container's process limit.
- **Teardown.** Something has to flush the op log when the child exits.

## The control layer

Everything an emulator does passes through one function. Emulators know nothing
about faults; they hand over an `Op` and honour the `Verdict`.

```go
op := control.Op{Emulator: "postgres", Kind: "COMMIT"}
verdict := interceptor.Before(op)   // Delay, DropConn, Err
```

Counting lives in the interceptor rather than in each emulator, so "fail the third
commit" means one thing across four protocols.

### Fault rules

```json
{ "match": "postgres.COMMIT", "after": 2, "times": 1, "action": "error",
  "message": "could not serialize access due to concurrent update" }
{ "match": "queue.publish", "when": { "depth_gte": 100 }, "action": "error" }
{ "match": "redis.*", "action": "delay", "ms": 250 }
{ "match": "queue.publish", "action": "cap", "limit": 100 }
```

| Field | Meaning |
|---|---|
| `match` | `<emulator>.<kind>`; either segment may be `*`, and `*` alone matches everything. A partial glob like `re*` matches nothing — it reads as a typo. |
| `after` | How many matching operations pass untouched first. `after: 2` fires from the third. |
| `times` | How often the rule fires. Absent means every occurrence once `after` is past. |
| `when` | Gates the rule on gauges the backend reports about itself, keyed `<gauge>_gte` or `<gauge>_lte`. A gauge nothing reports satisfies nothing. |
| `action` | `error`, `delay` (needs `ms`), `drop_conn`, or `cap` (needs `limit`). |

Two details worth knowing before writing a lesson:

- **`cap` is a capacity, not an offset.** `limit: 100` lets a hundred operations
  through and fails every one after, forever. `after`/`times` express a position
  in a sequence; `cap` expresses how much a service will take.
- **Rules compete only within their own half of the verdict.** One half decides an
  operation's timing, the other its outcome, so a blanket `redis.* delay` listed
  first still leaves a specific `redis.SET error` free to fire. A rule whose half
  is already taken is skipped without spending its `times` budget.

A field an action does not read is an error rather than something ignored: a rule
that quietly does not do what it says would let a lesson pass everyone.

### The op log

One JSON line on stdout after the child exits, tagged so rce-service can pick it
out of student output:

```json
{"emu_oplog":[
  {"n":1,"emu":"postgres","op":"CONNECT"},
  {"n":4,"emu":"postgres","op":"COMMIT"},
  {"n":9,"emu":"postgres","op":"COMMIT","fault":"error"},
  {"n":10,"emu":"redis","op":"INCR","target":"rate:1"}
]}
```

Ordinals come from a logical counter, never the clock, so two runs of the same
program produce the same log. It is what lets a lesson grade *behaviour* — "did
they retry the failed commit?" is answerable from this and not from stdout.

The log is a ring bounded by `log_limit`, because every operation appends and a
tight student loop would otherwise be unbounded memory. What it dropped is
reported as `emu_oplog_dropped`, so truncation is never silent.

## A lesson run has no control channel

Faults come from `--config` and nothing else. `emu ctl` and the P2 dashboard talk
to an `emu` running **locally**, where there is no untrusted child.

This is not caution, it is a measured constraint. Student code shares emu's uid
(65534) in the same PID namespace, so any socket the controller can reach is one
the student can reach too — `verify-sandbox.sh` demonstrates student code
disarming every armed fault through the dev socket, and a root-owned socket is
both unreachable by `docker exec` without `CAP_DAC_OVERRIDE` and uncreatable
without `CAP_SETUID`. Full threat model in
[`../plans/emu-service.md`](../plans/emu-service.md).

Three things follow, and each is enforced rather than documented:

- **The socket opens only from `--dev-control-socket` on argv.** A lesson author
  influences config; only rce-service builds argv. The config loader has no field
  that reaches the control plane and rejects unknown fields outright, so a config
  that asks for one fails the run. Both halves are asserted by tests.
- **The op log records control-plane mutations.** A run that was driven live is
  identifiable afterwards instead of indistinguishable from one that was not.
- **`verify-sandbox.sh` checks that a config-driven run leaves no socket
  anywhere** under the real sandbox posture.

### emu ctl

```sh
emu run --config config.json --dev-control-socket ./emu.sock -- python3 app.py &

emu ctl fault add --socket ./emu.sock --match 'redis.*' --action delay --ms 250
emu ctl fault add --socket ./emu.sock --match queue.publish --action error \
    --after 2 --times 1 --when depth_gte=100
emu ctl fault list  --socket ./emu.sock
emu ctl fault reset --socket ./emu.sock
emu ctl oplog       --socket ./emu.sock
```

Line-delimited JSON over a Unix stream socket, one connection carrying any number
of requests, so the P2 dashboard can hold it open. There is no default socket
path: talking to the wrong emu by accident is worse than typing it.

## Config

```json
{
  "services": ["postgres", "redis"],
  "seed": {
    "postgres": ["CREATE TABLE accounts (id INT PRIMARY KEY, balance INT)"],
    "redis": { "rate:1": "0" }
  },
  "faults": [
    { "match": "postgres.COMMIT", "after": 2, "times": 1, "action": "error",
      "message": "could not serialize access due to concurrent update" }
  ],
  "log_limit": 500
}
```

Only what `services` declares is ever constructed or bound — most of what keeps
emu small. Seed data is held as raw JSON until P3–P6 give each backend something
to interpret it with.

The loader refuses anything that could not do what it appears to say: an unknown
service name, a service twice, seed data or a fault aimed at a service the lesson
never starts, and any field it does not know.

## Exit codes

The child's own exit code is passed through untouched. Codes emu produces itself
follow the shell and `sysexits.h`, so a broken lesson reads like a familiar error:

| Code | Meaning |
|---|---|
| `1` | the control socket could not be opened, or the op log could not be written |
| `2` | bad emu command line |
| `78` | the config is unusable (`EX_CONFIG`) |
| `126` | command found but not executable |
| `127` | command not found |
| `128+N` | child terminated by signal N |

## Layout

```
cmd/emu/               the binary
internal/cli/          command line parsing, wiring, exit codes
internal/config/       the lesson's config, and what it may not contain
internal/control/      Op, Verdict, rules, the interceptor, the dev socket
internal/oplog/        the graded artifact
internal/supervise/    PID 1 duties: spawn, forward signals, reap, exit code
```

## Development

```sh
just test-emu        # tests with a 100% coverage gate on internal/...
just lint-emu        # gofmt check + go vet
just build-emu       # static binary at emu-service/build/emu

./verify-sandbox.sh  # every check above, under the real sandbox posture
```

The static build is a hard requirement — the binary is mounted into whatever
image a lesson uses and must not depend on that image's libc. `just build-emu`
and the Dockerfile both assert the result is not dynamically linked.
