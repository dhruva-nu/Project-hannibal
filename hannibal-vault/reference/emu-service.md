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

## Status — all four emulators work, on the real execution path

A job on `rce.jobs` carrying an emulator config comes back with the student's
stdout, the exit code, and the op log as structured data — so all of the below
happens where lessons actually run, not only under test.

`psycopg` connects to `127.0.0.1:5432` with an ordinary connection string and a
fault on the third `COMMIT` fails it as a serialization error with that
transaction's writes actually gone. `redis.Redis(host="127.0.0.1", port=6379)`
reads seeded keys, and a fault on the third `SET` raises with the first two still
in the cache. `pika` connects to `127.0.0.1:5672` with ordinary
`ConnectionParameters`, publishes and consumes and acknowledges, and a
`when: {depth_gte: 100}` rule refuses the hundred and first publish. `pymongo`
connects to `127.0.0.1:27017` with an ordinary `MongoClient`, and a fault on the
third `insert` fails it as a write conflict with the first two documents still
there.

| Phase | Deliverable | Issue |
|---|---|---|
| **P0** | **supervisor** — spawn, signals, reap, exit code | [#147](https://github.com/dhruva-nu/Project-hannibal/issues/147) ✅ |
| **P1** | **control core** — `Op`, interceptor, fault rules, op log, `ctl` | [#148](https://github.com/dhruva-nu/Project-hannibal/issues/148) ✅ |
| **P2** | **control dashboard** | [#154](https://github.com/dhruva-nu/Project-hannibal/issues/154) ✅ |
| **P3** | **SQL DB on 5432** | [#149](https://github.com/dhruva-nu/Project-hannibal/issues/149) ✅ |
| **P4** | **cache on 6379** | [#150](https://github.com/dhruva-nu/Project-hannibal/issues/150) ✅ |
| **P5** | **queue on 5672** | [#151](https://github.com/dhruva-nu/Project-hannibal/issues/151) ✅ |
| **P6** | **document DB on 27017** | [#152](https://github.com/dhruva-nu/Project-hannibal/issues/152) ✅ |
| **P7** | **rce-service integration** — the real execution path | [#153](https://github.com/dhruva-nu/Project-hannibal/issues/153) ✅ |

P4, P5, and P6 each depended only on P1 and plugged into the seam P3 proved. Each
is a `Protocol` and a `Backend` plus one line in `internal/fleet`; none of the
three touched the serve loop or the control layer — P5 added push delivery without
touching either, and P6 is the proof that the seam holds for a protocol nothing
about it was designed around.

---

## Files

| Path | What it holds |
|---|---|
| `emu-service/cmd/emu/main.go` | the binary; one call into `internal/cli` |
| `emu-service/internal/cli/` | `Run`, `runChild`, `dev`, `ctl`, `install` — parsing, wiring, exit codes |
| `emu-service/internal/cli/install.go` | `emu install <path>` — how a scratch image publishes its own binary |
| `emu-service/internal/config/config.go` | the lesson's config, and what it may not contain |
| `emu-service/internal/control/` | `Op`, `Verdict`, `Rule`, `Interceptor`, the dev socket and HTTP plane, `dashboard.html` |
| `emu-service/internal/oplog/oplog.go` | the graded artifact, on stdout as one JSON line |
| `emu-service/internal/emulator/emulator.go` | `Protocol` / `Session` / `Backend` / `Executor` and the one serve loop every emulator reuses |
| `emu-service/internal/fleet/` | service name → a built, seeded, listening emulator; the only place that knows which services exist yet. One file per emulator (`fleet.go`, `redis.go`, `queue.go`, `mongo.go`) so that phases landing in parallel collide on one line of the registry and nothing else |
| `emu-service/internal/pgwire/` | the Postgres wire protocol: handshake, both query protocols, parameter decoding, type OIDs |
| `emu-service/internal/sqltext/` | the little that has to be read off a SQL statement — where one ends, which operation it is, what it acts on |
| `emu-service/internal/sqlitedb/` | SQL semantics over `modernc.org/sqlite`, per-connection transactions, SQLite errors as SQLSTATEs |
| `emu-service/internal/resp/` | the Redis protocol: RESP2 and RESP3 frames, command decoding, the driver's own commands |
| `emu-service/internal/kv/` | cache semantics: the key space, lazy expiry, Redis's own error strings |
| `emu-service/internal/amqp/` | the AMQP 0-9-1 wire protocol, hand-rolled: framing, methods, channels, publisher confirms, push delivery |
| `emu-service/internal/mq/` | the vocabulary `amqp` and `queues` share: `Message`, `Delivery`, `Sink`, the request payloads |
| `emu-service/internal/queues/` | queues, exchanges, routing, prefetch, and the deliveries a connection has not settled |
| `emu-service/internal/mongowire/` | the MongoDB wire protocol: `MsgHeader`, `OP_MSG` and the legacy `OP_QUERY` handshake, command dispatch, error documents |
| `emu-service/internal/mongocmd/` | the little that has to be read off a command document — which operation, what it acts on, whether emu answers it about itself |
| `emu-service/internal/docstore/` | document semantics: filters, updates, projections, sorting, cursors, BSON value ordering |
| `emu-service/internal/supervise/supervise.go` | `Supervisor.Run`, `start`, `reap`, `exitCode` — PID 1 duties |
| `emu-service/Dockerfile` | static musl-free build into a `scratch` image |
| `emu-service/verify-sandbox.sh` | every phase's exit criterion under the real sandbox posture |
| `.github/workflows/emu-service.yml` | fmt/vet · tests + 100% gate · static assertion · sandbox posture |

## The seam every emulator sits behind

```
:5432  ─ accept ─→ pgwire    ─→ Op{postgres.COMMIT} ─→ Interceptor ─→ sqlite
:6379  ─ accept ─→ resp      ─→ Op{redis.SET}       ─→ Interceptor ─→ kv
:5672  ─ accept ─→ amqp      ─→ Op{queue.publish}   ─→ Interceptor ─→ queues
:27017 ─ accept ─→ mongowire ─→ Op{mongo.insert}    ─→ Interceptor ─→ docstore
                   (decode)                              (fault?)     (execute)
                      ↑                                                   │
                      └──────────────── encode reply ────────────────────┘
```

Decoding is not optional: to fail the third `COMMIT` the control layer has to know
the frame *is* a `COMMIT`, which a raw byte tap cannot tell you.

A faulted operation never reaches the engine. A faulted `COMMIT` additionally
calls `Executor.Abort`, which rolls the transaction back — an exception the
student can catch while the rows landed anyway teaches the opposite of the lesson.
The document store has nothing for `Abort` to undo, because it has no
multi-document transaction: a faulted write is one it never saw.

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

## Three decisions in P6 worth knowing before changing it

- **The query evaluator is emu's own.** There is no pure-Go MongoDB engine to
  embed, so unlike SQL there is no library answering semantics. That makes the
  loud-failure rule load-bearing rather than tidy: every filter operator, update
  operator, and aggregation stage emu cannot evaluate is answered with
  `CommandNotSupported` and named. A plausible wrong answer is the one outcome that
  must be impossible.
- **`aggregate` exists even though the pipeline does not.** `count_documents` is
  `$match` + `$group {$sum: 1}` in every modern driver, so those stages plus
  `$skip`, `$limit`, and `$count` are evaluated and every other one is refused.
- **One database.** A lesson seeds collections and never names a database, so
  every database a client addresses reaches the same collections and
  `listDatabases` reports the one, called `emu`. No indexes either: `createIndexes`
  succeeds and every query is a scan.

---

## Why emu takes the container's command slot

A container runs exactly one command, so `emu` becomes PID 1 and starts the
student's process as its child:

```
# a request with no emulators, unchanged
sh -c 'echo <code> | base64 -d > /tmp/app.py && python3 -u /tmp/app.py'

# a lesson that declares them (rce_service/docker.py:_shell_command)
sh -c 'echo <config> | base64 -d > /tmp/emu-config.json &&
       echo <code>   | base64 -d > /tmp/app.py &&
       exec /emu/emu run --config /tmp/emu-config.json -- python3 -u /tmp/app.py'
```

**`exec` is load-bearing.** The container's command has always been a `sh -c`
wrapper, so without it emu is a child of that shell rather than PID 1 — and every
row of the security table below stops applying: student code sharing uid 65534
could kill the process injecting the faults grading it, and orphans would
reparent to a shell that never reaps. `verify-sandbox.sh` asserts
`/proc/1/cmdline` is emu.

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
| `1` | the control socket, an emulator's port, or the op log failed |
| `2` | bad emu command line |
| `78` | the config is unusable (`EX_CONFIG`) — a lesson author's error, not a student's |
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
never enable them — only argv can. The argv rce-service builds is asserted to be
exactly `run --config <path>` in
`rce-service/tests/test_rce_security_invariants.py`.

---

## How the binary reaches a lesson (P7)

A named volume, `emu-bin`, mounted **read-only** at `/emu` — the same posture
`deps/cache.py` gives the package caches. Populated at build time, never by the
worker, which cannot compile Go:

| Where | How |
|---|---|
| local | `just publish-emu` |
| compose | the one-shot `emu-publisher` service, which `rce-service` waits on |
| CI | the `publish` job in `.github/workflows/emu-service.yml` |

All three run the same three commands: build the image, create the volume,
`docker run --rm -v emu-bin:/out emu install /out/emu`. **`emu install` exists
because the shipped image is `FROM scratch` and has no shell** — there is no `cp`
to run, so the binary copies itself, writing a `.partial` and renaming so a
concurrent mount never sees half a binary.

A missing volume fails the run loudly (`EmuNotPublished`, logged with the fix)
rather than reaching the student as `exec /emu/emu: no such file`.

**The config is not bind-mounted.** rce-service drives the host Docker daemon from
inside its own container, so a path it can write is not a path that daemon could
mount — which is why the student's code already travels base64-encoded inside the
command. The config rides the same way, into `/tmp/emu-config.json`. Safe in a
student-writable tmpfs because emu reads it, arms the faults, and binds the ports
before the child exists.

## The op log in the result

`ResultBody.emu_oplog` — absent for a run that declared no emulators, so "no
emulators" and "emulators nothing touched" stay distinguishable.

- emu writes its dump **after the child exits**, so it is always the last line of
  stdout, and rce-service reads **only** the last line. That is what stops a
  student printing a forged `emu_oplog` line and having it graded.
- The split happens **before** the 256 KB output truncation, so a chatty program
  cannot push the graded artifact out of the result.
- Truncation by the ring buffer is self-describing: entries carry a logical
  ordinal, so a log that does not start at `n: 1` lost its oldest entries.
- A **streamed** run gets its emulators but not its op log — Docker merges the
  streams, so the dump is filtered out and returned with the verdict from the sync
  run, which is where grading already happens.

## Measured cost (real sandbox posture)

| Phase | binary on disk | RSS |
|---|---|---|
| P0, supervisor alone | 2.7 MB | 5.3 MB |
| P2, HTTP server linked in | 6.1 MB | 5.4 MB |
| P3, pgproto3 + SQLite | 10.3 MB | 5.9 MB |
| P4, + RESP and the key space | 10.4 MB | 5.5 MB |
| P5, + hand-rolled AMQP and in-memory queues | 10.5 MB | 6.5 MB |
| P6, + BSON and the document store | 11.4 MB | 5.4 MB |
| P7, + `emu install` | 11.4 MB | — |

The disk column is the stacked binary at that phase, in MiB — the unit `du -h` and
`just build-emu` report; the last row is the real stacked binary this branch
builds, 11,911,330 bytes, of which P7 is 8 KB. Four times the disk between P0 and P3 for half a megabyte
resident, because linked code that nothing calls is never paged in. P4 and P5 add
about 0.1 MB each and no dependency at all: there is no Go server-side AMQP library
to link. P6 costs the most of the three, 0.9 MB, and is the only one of them that
links a library — `go.mongodb.org/mongo-driver/v2/bson`, because BSON is a codec
worth borrowing rather than a semantics engine worth refusing. A mongo-only lesson
still costs *less* resident than a SQL one, because SQLite is linked and never
touched. The RSS column is not comparable row to row — each phase measured its own
run, and the run that saw 6.5 MB for the queue saw 6.9 MB for the P3 config beside
it. The plan's working budget is ~20 MB, so every emulator fits.

P7, with the emulator **seeded and in use**, `GOMAXPROCS=1` and
`GOMEMLIMIT=48MiB`, measured across the whole sandbox cgroup:

| | tasks | RSS | cgroup `memory.peak` |
|---|---|---|---|
| `sleep` alone, no emu | 1 | 0.5 MB | 7.9 MB |
| emu + child, no config | 8 | 5.4 MB | 8.4 MB |
| emu + seeded postgres + child | 7 | 5.6 MB | 9.7 MB |
| the transfer lesson through `pg8000` | 6 | — | 23 MB |
| the same, plus 50,000 inserted rows | 7 | — | 57 MB |

A seeded SQL emulator costs **1.8 MB and one task**. `LIMITS` is therefore 32 pids
/ 192 MB / 30 s not because emu needs it but because the *lesson's data* shares
the cgroup — and a cap costs nothing until a lesson uses it.

---

## → Calls

- `rce_service/emu.py` — everything rce-service knows about emu: the volume, the
  argv, the config, the op log split
- `rce_service/docker.py:_shell_command` / `_start_container` — where the command
  is wrapped and the binary mounted
- `rce_service/config.py:LIMITS` — 32 pids / 192 MB / 30 s
- `rce_service/contracts.py:EmuConfigV1` — the lesson's config on the wire, and
  `ResultBody.emu_oplog` coming back
- `rce_service/deps/cache.py:run_phase_mounts` — the read-only named-volume
  pattern the binary reuses

## → See also

- `hannibal-vault/features/code-execution.md` — the execution path emu plugs into
- `hannibal-vault/reference/justfile.md` — `just test-emu` / `lint-emu` / `build-emu`
