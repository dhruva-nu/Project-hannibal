# emu-service

A single static Go binary that runs inside the existing no-network code execution
container and serves infrastructure emulators — a SQL DB, cache, queue, and
document DB — on loopback, behind a control layer that can make any operation
fail on demand.

Plan and phase breakdown: [`../plans/emu-service.md`](../plans/emu-service.md)

## Current state — P0, the supervisor

Only the supervisor exists. No emulators, no control plane, no config.

```
emu run -- <command> [args...]   run <command>, supervised
emu help                         show usage
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
is what this phase exists to settle:

- **Startup race.** The child can `connect(5432)` before the emulators are bound.
  `emu` binds every port before spawning, and nothing else can guarantee that.
- **Exit code.** The platform grades on it; a shell wrapper reports its own.
- **Zombies.** As PID 1 `emu` inherits orphaned grandchildren, and an unreaped
  zombie holds a slot against the container's process limit.
- **Teardown.** Something has to flush the op log when the child exits.

## Exit codes

The child's own exit code is passed through untouched. Codes emu produces itself
follow shell convention, so a broken lesson command looks familiar:

| Code | Meaning |
|---|---|
| `2` | bad emu command line |
| `126` | command found but not executable |
| `127` | command not found |
| `128+N` | child terminated by signal N |

## Layout

```
cmd/emu/               the binary
internal/cli/          command line parsing, exit codes
internal/supervise/    PID 1 duties: spawn, forward signals, reap, exit code
```

## Development

```sh
just test-emu        # tests with a 100% coverage gate on internal/...
just lint-emu        # gofmt check + go vet
just build-emu       # static binary at emu-service/build/emu
```

The static build is a hard requirement — the binary is mounted into whatever
image a lesson uses and must not depend on that image's libc. `just build-emu`
and the Dockerfile both assert the result is not dynamically linked.
