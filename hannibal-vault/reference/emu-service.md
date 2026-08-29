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

## Status — the SQL database, the cache, and the message queue work end to end

`psycopg` connects to `127.0.0.1:5432` with an ordinary connection string and a
fault on the third `COMMIT` fails it as a serialization error with that
transaction's writes actually gone. `redis.Redis(host="127.0.0.1", port=6379)`
reads seeded keys, and a fault on the third `SET` raises with the first two still
in the cache. `pika` connects to `127.0.0.1:5672` with ordinary
`ConnectionParameters`, publishes and consumes and acknowledges, and a
`when: {depth_gte: 100}` rule refuses the hundred and first publish.

| Phase | Deliverable | Issue |
|---|---|---|
| **P0** | **supervisor** — spawn, signals, reap, exit code | [#147](https://github.com/dhruva-nu/Project-hannibal/issues/147) ✅ |
| **P1** | **control core** — `Op`, interceptor, fault rules, op log, `ctl` | [#148](https://github.com/dhruva-nu/Project-hannibal/issues/148) ✅ |
| **P2** | **control dashboard** | [#154](https://github.com/dhruva-nu/Project-hannibal/issues/154) ✅ |
| **P3** | **SQL DB on 5432** | [#149](https://github.com/dhruva-nu/Project-hannibal/issues/149) ✅ |
| **P4** | **cache on 6379** | [#150](https://github.com/dhruva-nu/Project-hannibal/issues/150) ✅ |
| **P5** | **queue on 5672** | [#151](https://github.com/dhruva-nu/Project-hannibal/issues/151) ✅ |
| P6 | document DB on 27017 | [#152](https://github.com/dhruva-nu/Project-hannibal/issues/152) |
| P7 | rce-service integration | [#153](https://github.com/dhruva-nu/Project-hannibal/issues/153) |

P6 depends only on P1 and plugs into the seam P3 proved and P4 and P5 reused. Each
is a `Protocol` and a `Backend` plus one line in `internal/fleet`; neither P4 nor
P5 touched the serve loop or the control layer — P5 added push delivery without
touching either — which is the evidence that the seam holds.

---

## Files

| Path | What it holds |
|---|---|
| `emu-service/cmd/emu/main.go` | the binary; one call into `internal/cli` |
| `emu-service/internal/cli/` | `Run`, `runChild`, `dev`, `ctl` — parsing, wiring, exit codes |
| `emu-service/internal/config/config.go` | the lesson's config, and what it may not contain |
| `emu-service/internal/control/` | `Op`, `Verdict`, `Rule`, `Interceptor`, the dev socket and HTTP plane, `dashboard.html` |
| `emu-service/internal/oplog/oplog.go` | the graded artifact, on stdout as one JSON line |
| `emu-service/internal/emulator/emulator.go` | `Protocol` / `Session` / `Backend` / `Executor` and the one serve loop every emulator reuses |
| `emu-service/internal/fleet/fleet.go` | service name → a built, seeded, listening emulator; the only place that knows which services exist yet |
| `emu-service/internal/pgwire/` | the Postgres wire protocol: handshake, both query protocols, parameter decoding, type OIDs |
| `emu-service/internal/sqltext/` | the little that has to be read off a SQL statement — where one ends, which operation it is, what it acts on |
| `emu-service/internal/sqlitedb/` | SQL semantics over `modernc.org/sqlite`, per-connection transactions, SQLite errors as SQLSTATEs |
| `emu-service/internal/resp/` | the Redis protocol: RESP2 and RESP3 frames, command decoding, the driver's own commands |
| `emu-service/internal/kv/` | cache semantics: the key space, lazy expiry, Redis's own error strings |
| `emu-service/internal/fleet/redis.go` | the cache's builder; one file per service so that phases landing in parallel collide on one line of the registry and nothing else |
| `emu-service/internal/amqp/` | the AMQP 0-9-1 wire protocol, hand-rolled: framing, methods, channels, publisher confirms, push delivery |
| `emu-service/internal/mq/` | the vocabulary `amqp` and `queues` share: `Message`, `Delivery`, `Sink`, the request payloads |
| `emu-service/internal/queues/` | queues, exchanges, routing, prefetch, and the deliveries a connection has not settled |
| `emu-service/internal/fleet/queue.go` | the AMQP broker's one line in the registry |
| `emu-service/internal/supervise/supervise.go` | `Supervisor.Run`, `start`, `reap`, `exitCode` — PID 1 duties |
| `emu-service/Dockerfile` | static musl-free build into a `scratch` image |
| `emu-service/verify-sandbox.sh` | every phase's exit criterion under the real sandbox posture |
| `.github/workflows/emu-service.yml` | fmt/vet · tests + 100% gate · static assertion · sandbox posture |

## The seam every emulator sits behind

```
:5432 ─ accept ─→ pgwire ─→ Op{postgres.COMMIT} ─→ Interceptor ─→ sqlite
:5672 ─ accept ─→ amqp   ─→ Op{queue.publish}   ─→ Interceptor ─→ queues
                  (decode)                        (fault?)       (execute)
                     ↑                                              │
                     └──────────── encode reply ────────────────────┘
```

Decoding is not optional: to fail the third `COMMIT` the control layer has to know
the frame *is* a `COMMIT`, which a raw byte tap cannot tell you.

A faulted operation never reaches the engine. A faulted `COMMIT` additionally
calls `Executor.Abort`, which rolls the transaction back — an exception the
student can catch while the rows landed anyway teaches the opposite of the lesson.

The cache is the same picture one port along, and adding it changed no file in
`emulator/` or `control/`:

```
:6379 ─ accept ─→ resp ─→ Op{redis.SET} ─→ Interceptor ─→ kv
                 (decode)                  (fault?)      (execute)
```

## Three decisions in P3 worth knowing before changing it

- **The SQL database is a WAL file in `/tmp`, not `:memory:`.** Shared-cache
  in-memory is the only in-memory mode two connections can both see and it has no
  MVCC, so a reader waits on a writer's open transaction indefinitely. `/tmp` is a
  tmpfs in the sandbox, so this is still memory.
- **An injected fault defaults to SQLSTATE `40001`.** A driver reacts to the code,
  not the sentence; `40001` is what psycopg turns into `SerializationFailure` and
  retries. A rule may name another with `"code"`.
- **emu cannot describe a statement it has not run.** `Describe(statement)`
  answers the parameter types and `NoData`; the columns come from the portal's own
  `Describe`, which psycopg, node-postgres, and libpq's `ExecPrepared` all send.

## Four decisions in P4 worth knowing before changing it

- **No `miniredis`, though the plan named it.** `Miniredis.start` is unexported and
  takes a `*server.Server`, which only `server.NewServer(addr)` builds — and that
  binds a TCP listener before a command is registered. A second listener on
  loopback is one student code reaches directly, skipping `Interceptor.Before`.
  Its one hook, `SetPreHook`, lives inside miniredis's own dispatch loop, so it
  would leave `fleet` unable to bind 6379 and `redis.CONNECT` with nowhere to come
  from. And its TTLs do not decrease at all — by design, since it is a unit-test
  server. `internal/kv` costs 0.1 MB of binary; miniredis's direct API alone would
  have linked 2.0 MB and is a key space too, with no arity checks and no clock.
- **This is the opposite call from `sqlitedb`, on purpose.** An SQL engine answers
  *semantics* — the join, the `GROUP BY` — which is weeks of work and the thing a
  student's wrong query has to be caught by. A cache has none: `GET` returns what
  `SET` put there.
- **RESP3 as well as RESP2, because redis-py 8 defaults to it** and raises on
  `NOPROTO` rather than falling back. The gap is three frames: null is `_`, a map
  is `%`, and `HELLO` answers with the version it was asked for.
- **`redis.CONNECT` fires on the first command that is not driver bookkeeping**,
  not at `accept`. RESP has no handshake, and both redis-py and go-redis swallow
  errors on their own setup commands, so a refusal delivered there would vanish.
  `HELLO`, `CLIENT`, and `COMMAND` are answered in `resp` and stay out of the op
  log, the way `pgwire` answers `DEALLOCATE`.

## Three decisions in P5 worth knowing before changing it

- **The codec is handed the backend.** A rule's `when` clause is evaluated before
  the operation runs, so `amqp.New(backend)` takes a meter and attaches `depth`,
  `unacked`, and `consumers` to every Op. This is the only place an emulator's
  protocol and backend are wired to each other rather than only to the seam.
- **Push delivery lives in the session, not in the loop.** `Session.Next` selects
  over the next client frame, an outbox the backend pushes deliveries into, and
  the heartbeat clock. `internal/emulator` is unchanged, which is what keeps it
  shared with three other emulators.
- **A publish is asynchronous.** A faulted publish becomes a channel exception
  the client notices at its next synchronous call, unless it turned publisher
  confirms on — which is what makes "the 101st publish fails" fail on the 101st.

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

## Security — the child is untrusted and shares PID 1's uid

Student code runs as uid 65534 in the same PID namespace as emu. Measured in
`emu-service/verify-sandbox.sh`, which CI runs on every change:

| Attempt | Result |
|---|---|
| `SIGKILL` / `SIGSTOP` to PID 1 from inside the namespace | **silently discarded** — the kernel refuses signals namespace init has no handler for |
| `SIGTERM` to PID 1 | delivered, then relayed back to the child; the child only signals itself |
| flooding PID 1 with signals | harmless — see `signalBuffer` in `supervise.go:21` |
| connect to a same-uid Unix socket at mode `0600` | **succeeds** — same owner means write permission |
| root via `docker exec` to a 65534-owned socket | **refused** — `cap_drop=ALL` removes `CAP_DAC_OVERRIDE` |
| `setuid()` as root inside the container | **refused** — `cap_drop=ALL` removes `CAP_SETUID` |

**emu cannot be killed by the student** — the kernel protects namespace init.

**There is no socket the controller can reach that the student cannot**, so
in-sandbox mid-run control is incompatible with the sandbox posture. Hence the
decision recorded in the plan: **a lesson run has no control channel at all.**
Faults come from `--config`, the op log leaves on stdout, and `emu ctl` lives
behind `--dev-control-socket` / `--dev-control-bind` for a locally-run emu that
has no untrusted child. rce-service never passes those flags, and config can
never enable them — only argv can.

## Measured cost (real sandbox posture)

| | tasks | emu threads | RSS |
|---|---|---|---|
| python alone (today) | 1 | — | — |
| emu + child, default `GOMAXPROCS` | 9 | 7 | 5.5 MB |
| emu + child, `GOMAXPROCS=1` | 6 | 5 | — |

| Phase | binary on disk | RSS |
|---|---|---|
| P0, supervisor alone | 2.7 MB | 5.3 MB |
| P2, HTTP server linked in | 6.1 MB | 5.4 MB |
| P3, pgproto3 + SQLite | 10.3 MB | 5.9 MB |
| P4, + RESP and the key space | 10.4 MB | 5.5 MB |
| P5, + hand-rolled AMQP and in-memory queues | 10.5 MB | 6.5 MB |

The disk column is the stacked binary at that phase, in MiB — the unit `du -h` and
`just build-emu` report. Four times the disk between P0 and P3 for half a megabyte
resident, because linked code that nothing calls is never paged in. P4 and P5 add
about 0.1 MB each and no dependency at all: there is no Go server-side AMQP
library to link. The RSS column is not comparable row to row — each phase measured
its own run, and the run that saw 6.5 MB for the queue saw 6.9 MB for the P3 config
beside it. The plan's working budget is ~20 MB, so P6 has room.

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
