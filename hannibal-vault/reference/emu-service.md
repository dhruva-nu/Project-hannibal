# emu-service — Infrastructure Emulators (Go)

A single **static Go binary** that runs *inside* the existing no-network code
execution container and serves infrastructure emulators — SQL DB, cache, queue,
document DB — on loopback, behind a control layer that can make any operation
fail on demand.

Students get real drivers and real connection strings with no shims. Lessons get
a switch that fails the third `COMMIT` or rejects a publish once a queue hits
depth 100.

**Plan and phase breakdown:** `plans/emu-service.md`
**Tracking:** [#146](https://github.com/dhruva-nu/Project-hannibal/issues/146)

---

## Why it exists

The RCE sandbox runs untrusted code with `network_mode="none"` and one container
per execution (`rce_service/docker.py:71`). That makes container-to-container
infrastructure impossible, so a lesson cannot teach "your service talks to a DB
and a queue" — there is nothing to talk to.

emu puts the infrastructure *in the same process as nothing else*: loopback needs
no network, and no new container is created.

---

## Status — P0 only

Only the supervisor exists. No emulators, no control plane, no config.

| Phase | Deliverable | Issue |
|---|---|---|
| **P0** | **supervisor** — spawn, signals, reap, exit code | [#147](https://github.com/dhruva-nu/Project-hannibal/issues/147) ✅ |
| P1 | control core — `Op`, interceptor, fault rules, op log, `ctl` | [#148](https://github.com/dhruva-nu/Project-hannibal/issues/148) |
| P2 | control dashboard | [#154](https://github.com/dhruva-nu/Project-hannibal/issues/154) |
| P3 | SQL DB on 5432 | [#149](https://github.com/dhruva-nu/Project-hannibal/issues/149) |
| P4 | Redis on 6379 | [#150](https://github.com/dhruva-nu/Project-hannibal/issues/150) |
| P5 | queue on 5672 | [#151](https://github.com/dhruva-nu/Project-hannibal/issues/151) |
| P6 | document DB on 27017 | [#152](https://github.com/dhruva-nu/Project-hannibal/issues/152) |
| P7 | rce-service integration | [#153](https://github.com/dhruva-nu/Project-hannibal/issues/153) |

---

## Files

| Path | What it holds |
|---|---|
| `emu-service/cmd/emu/main.go` | the binary; one call into `internal/cli` |
| `emu-service/cmd/emu/main_test.go` | end-to-end tests that build and run the real binary |
| `emu-service/internal/cli/cli.go` | `Run`, `SplitCommand`, `startFailureCode` — parsing and exit codes |
| `emu-service/internal/supervise/supervise.go` | `Supervisor.Run`, `start`, `reap`, `exitCode` — PID 1 duties |
| `emu-service/Dockerfile` | static musl-free build into a `scratch` image (2.6 MB) |
| `emu-service/verify-sandbox.sh` | P0 exit criterion under the real sandbox posture |
| `.github/workflows/emu-service.yml` | fmt/vet · tests + 100% gate · static assertion · sandbox posture |

---

## Why emu takes the container's command slot

A container runs exactly one command, so `emu` becomes PID 1 and starts the
student's process as its child:

```
# today
python3 -u /tmp/app.py

# once P7 lands
/emu/emu run --config /emu/config.json -- python3 -u /tmp/app.py
```

Backgrounding `emu` alongside the child (`sh -c 'emu & python3 app.py'`) fails
four ways, which is what P0 settles:

- **Startup race** — the child can `connect(5432)` before the emulators bind.
  `emu` binds every port *before* spawning; backgrounding cannot guarantee that.
- **Exit code** — the platform grades on it; a shell wrapper reports its own.
- **Zombies** — orphaned grandchildren reparent to PID 1, and an unreaped zombie
  holds a slot against the container's process limit.
- **Teardown** — something must flush the op log when the child exits.

`reap` therefore waits on `-1` rather than the tracked pid alone, and the
supervisor deliberately never calls `cmd.Wait()`: a Go PID 1 that does both races
its own reaper and loses the child's exit status.

---

## Exit codes

The child's code passes through untouched. Codes emu produces itself follow shell
convention.

| Code | Meaning |
|---|---|
| `2` | bad emu command line |
| `126` | command found but not executable |
| `127` | command not found |
| `128+N` | child terminated by signal N |

---

## Measured cost (P0, real sandbox posture)

| | tasks | emu threads | RSS |
|---|---|---|---|
| python alone (today) | 1 | — | — |
| emu + child, default `GOMAXPROCS` | 9 | 7 | 5.5 MB |
| emu + child, `GOMAXPROCS=1` | 6 | 5 | — |

`pids_limit` is **10** today (`rce_service/config.py:32`). emu plus a child
measures 9, so a trivial script squeezes through but any student thread or
subprocess does not — P7 raises it to 32.

---

## → Calls

- `rce_service/docker.py:_start_container` — the sandbox posture emu must run
  under, and where P7 wraps the run command
- `rce_service/config.py:LIMITS` — the `pids` / `memory` / `time` values P7 moves
- `rce_service/deps/cache.py:run_phase_mounts` — the read-only named-volume
  pattern P7 reuses to inject the binary

## → See also

- `hannibal-vault/features/code-execution.md` — the execution path emu plugs into
- `hannibal-vault/reference/justfile.md` — `just test-emu` / `lint-emu` / `build-emu`
