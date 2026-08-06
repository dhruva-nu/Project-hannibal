# emu-service

A single static Go binary that runs inside the existing no-network code execution
container and serves infrastructure emulators — a SQL DB, cache, queue, and
document DB — on loopback, behind a control layer that can make any operation
fail on demand.

Plan and phase breakdown: [`../plans/emu-service.md`](../plans/emu-service.md)

## Current state — P0 supervisor, P1 control core, P2 dashboard

The supervisor, the control layer every emulator will sit behind, and the tool we
develop the emulators with. No protocol code yet, so no emulator binds a port and
nothing calls `Before` on its own — P3 hands the interceptor to the first one.

```
emu run [flags] -- <command> [args...]   run <command>, supervised
emu dev [flags]                          serve the dashboard, no child process
emu ctl <command> --socket <path>        drive a locally-running emu (dev only)
emu help                                 show usage
```

## The dashboard

```sh
just build-emu
./build/emu dev --config lesson.json      # http://127.0.0.1:9100
```

One page, served from the binary. No build step, no package manager, nothing
fetched at runtime — a strict consequence of it being a dev tool that ships inside
the same static binary the sandbox mounts.

| Panel | What it does |
|---|---|
| services | What the config declared. None of them binds a port until P3–P6. |
| fault rules | Arm, disarm, and reset rules against the running process. |
| fire an operation | Drive the interceptor directly and see the verdict. |
| run a command | Start a child through the real supervisor and watch its output. |
| op log | Live, faulted rows marked, synthetic operations labelled. |

It polls `/api/state?since=N&output=M` every 600ms and gets only what it has not
seen. Server-sent events would be the textbook answer; a cursor over a bounded log
is a tenth of the moving parts and there is no reconnect or backpressure semantics
to get wrong.

### Firing operations by hand

P1 has no emulators, so there is nothing to send a real `COMMIT` to. The dashboard
pushes a synthetic `Op` straight at the interceptor instead, which is exactly how
the rule engine is meant to be exercised before a protocol exists. Those entries
are marked `synthetic` in the op log — without that, the log could be read as
evidence a client did something the operator did.

### Running a command

`emu dev` can start a child through the same supervisor a lesson's child gets, so
what you exercise is the real path. Output arrives as chunks tagged `stdout` or
`stderr`, which means the two streams interleave only as precisely as two pipes
allow — near enough for reading, not a guarantee of ordering between them.

An `emu run --dev-control-bind ...` that is already supervising a lesson's child
refuses to start a second one, and the page hides the panel. Two supervisors in
one process both reap with `wait(-1)`, so each would collect the other's exit
status and report the wrong code.

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

Faults come from `--config` and nothing else. `emu ctl` and the dashboard talk to
an `emu` running **locally**, where there is no untrusted child.

This is not caution, it is a measured constraint. Student code shares emu's uid
(65534) in the same PID namespace, so any socket the controller can reach is one
the student can reach too — `verify-sandbox.sh` demonstrates student code
disarming every armed fault through the dev socket, and a root-owned socket is
both unreachable by `docker exec` without `CAP_DAC_OVERRIDE` and uncreatable
without `CAP_SETUID`. Full threat model in
[`../plans/emu-service.md`](../plans/emu-service.md).

Three things follow, and each is enforced rather than documented:

- **The control channels open only from argv** — `--dev-control-socket` and
  `--dev-control-bind`. A lesson author influences config; only rce-service builds
  argv. The config loader has no field that reaches the control plane and rejects
  unknown fields outright, so a config that asks for one fails the run. Both halves
  are asserted by tests.
- **The dashboard refuses a non-loopback address.** `--dev-control-bind :9100`
  binds every interface; on a laptop on a shared network that hands anyone a fault
  injector and a live op log. Only loopback is accepted.
- **The op log records control-plane mutations.** A run that was driven live is
  identifiable afterwards instead of indistinguishable from one that was not.
- **`verify-sandbox.sh` checks that a config-driven run leaves no socket and binds
  no port** under the real sandbox posture. Loopback exists even under
  `--network none`, so "no network" is not what keeps the dashboard shut.

### The HTTP control plane

What the page talks to, and what a script can drive just as well:

| Route | |
|---|---|
| `GET /api/state?since=N&output=M` | everything the page shows, incrementally |
| `POST /api/faults` | arm a rule |
| `DELETE /api/faults/{index}` | disarm one |
| `POST /api/faults/reset` | disarm all |
| `POST /api/ops` | fire a synthetic operation, get the verdict |
| `POST /api/child` · `DELETE /api/child` | start and stop a command (`emu dev` only) |

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
internal/control/      Op, Verdict, rules, the interceptor, the dev channels
  dashboard.html       the page, embedded in the binary
internal/oplog/        the graded artifact
internal/supervise/    PID 1 duties: spawn, forward signals, reap, exit code
```

Linking an HTTP server in takes the binary from 2.7 MB to 6.1 MB on disk. In the
sandbox it costs about 50 KB resident — 5.76 MB before, 5.81 MB after — because
code nothing calls is never paged in. Measured by `verify-sandbox.sh`, so a build
tag to keep the lesson binary lean would buy disk and nothing else.

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
