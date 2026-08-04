# emu-service — implementation plan

A single static Go binary injected into the existing no-network run container. It
serves real wire protocols on loopback so student code talks to a "real" SQL DB,
document DB, cache, and queue — and gives us a control layer that can make any
operation fail on demand.

**Assumption to confirm:** we depend on third-party Go wire-protocol libraries
(`miniredis`, `pgproto3`, `modernc.org/sqlite`). Writing protocol parsers
ourselves is weeks of work for zero teaching value.

---

## The three ideas

**1. `emu` is PID 1; student code is its child.**

```
docker run --network none  python:3.11-alpine \
  /emu/emu run --config /emu/config.json -- python3 -u /tmp/abc.py
```

`emu` binds `127.0.0.1:6379`, `:5432`, `:27017`, `:5672`, spawns the student
process, waits, tears down, prints a JSON summary. Loopback needs no network, and
no new container is created. The binary arrives via a read-only named volume —
the exact pattern `rce_service/deps/cache.py` already uses for package caches.

**2. The port layer decodes; it does not proxy.**

Everything arriving on a port is decoded into an `Op` before anything else
happens. This is not optional: to fail the 3rd `COMMIT` the layer has to know the
frame *is* a COMMIT, which a raw byte tap cannot tell you.

```
:5432 ─ accept ─→ pgwire codec ─→ Op{sql.COMMIT} ─→ Interceptor ─→ sqlite backend
                    (decode)                          (fault?)        (execute)
                        ↑                                                 │
                        └────────── encode reply ─────────────────────────┘
```

One registry maps port → codec → backend. The codec is the only
protocol-specific code in the process; `Op` and everything downstream is shared.

| Port | Codec | Backend | Op kinds |
|---|---|---|---|
| 5432 | pgwire | sqlite (in-mem) | `sql.QUERY` `sql.COMMIT` |
| 6379 | RESP | miniredis | `redis.GET` `redis.SET` |
| 5672 | AMQP | in-mem queues | `queue.publish` `queue.ack` |
| 27017 | mongo wire | in-mem docs | `doc.find` `doc.insert` |

A raw byte tap exists only as a `--trace` debug flag that hex-dumps frames.

**3. Every emulator sits behind one function.**

```go
type Op struct { Kind, Target string; Args any }          // "redis.SET", "sql.COMMIT", "queue.publish"
type Interceptor interface { Before(Op) error }           // non-nil error => the emulator returns that error to the client
```

That is the whole control layer. Emulators know nothing about faults; they call
`Before` and honour the error. Fault rules are declarative:

```json
{ "match": "sql.COMMIT", "after": 3, "times": 1, "action": "error",
  "message": "could not serialize access due to concurrent update" }
{ "match": "queue.publish", "when": { "depth_gte": 100 }, "action": "error" }
{ "match": "redis.*", "action": "delay", "ms": 250 }
```

Actions: `error`, `delay`, `drop_conn`, `cap`. Counting happens in the
interceptor, not per emulator.

---

## Control channel (no network)

- **At start:** `--config` file, bind-mounted. Seed data + fault rules. This is
  the *only* control a lesson run gets — see the threat model below.
- **After:** the op log is dumped to stdout as one JSON line, tagged so
  rce-service can separate it from student output.
- **Mid-run:** dev only. `emu --dev-control-socket <path>` / `--dev-control-bind
  <addr>` enables `emu ctl` and the P2 dashboard against an `emu` running locally.
  Never passed by rce-service, because inside the sandbox any socket the
  controller can reach is one the student can reach too.

Op log ordering uses a logical counter, never wall clock, so runs are reproducible.

### Threat model — the child is untrusted and shares PID 1's uid

Student code runs as the same uid (65534) in the same PID namespace as `emu`, so
"can a student disarm the fault that is grading them?" has to be answered before
a control channel exists. Measured, not assumed (`emu-service/verify-sandbox.sh`):

| Attempt | Result |
|---|---|
| `SIGKILL` / `SIGSTOP` to PID 1 from inside the namespace | **silently discarded** — the kernel refuses signals that namespace init has no handler for |
| `SIGTERM` to PID 1 | delivered, and relayed back to the child; the child only signals itself |
| connect to a same-uid Unix socket at mode `0600` | **succeeds** — same owner means write permission |
| root via `docker exec` to a 65534-owned socket | **refused** — `cap_drop=ALL` removes `CAP_DAC_OVERRIDE` |
| `setuid()` as root inside the container | **refused** — `cap_drop=ALL` removes `CAP_SETUID` |

Two conclusions, both load-bearing:

**emu cannot be killed by the student.** The earlier worry about `os.kill(1, 9)`
was wrong; the kernel protects namespace init. Nothing is needed here.

**There is no socket that the controller can reach and the student cannot.** The
student reaches anything it owns, and a root-owned socket is unreachable by
`docker exec` without `CAP_DAC_OVERRIDE` and uncreatable without `CAP_SETUID`.
In-sandbox mid-run control is therefore incompatible with the current posture — it
would take `cap_add: [SETUID, SETGID]` plus running emu as root, which also means
parsing untrusted protocol bytes at higher privilege.

### Decision — lesson runs have no control channel

- **Faults come only from `--config`,** which is enough: `after: N`, `times`, and
  `when: {depth_gte}` express "fail the third commit" deterministically.
- **The op log leaves on stdout.** Output only, nothing to write to.
- **The socket and HTTP control planes sit behind explicit dev-only flags**, used
  by the P2 dashboard against an `emu` running locally, where no untrusted child
  exists. rce-service never passes them.
- **The config file must never be able to enable a control channel.** A lesson
  author (or a compromised lesson) influences config; only rce-service builds
  argv. P1 carries a test asserting the config loader has no such knob.
- **The op log records control-plane mutations,** so a run that had live control
  is identifiable after the fact rather than indistinguishable.

The sandbox posture is unchanged: no added capabilities, still uid 65534,
`cap_drop=ALL`, `no-new-privileges`.

---

## Staying small

P0 measured the supervisor at **5.5 MB RSS** in the real sandbox. miniredis with
seeded keys is negligible and in-memory sqlite is a few MB, so the working budget
for `emu` is **~20 MB** — still to be confirmed per phase rather than assumed.

Levers, biggest first:

1. **Start only what the lesson declares.** A cache-only lesson must never
   instantiate sqlite or bind 5432. Emulators are constructed lazily from
   config; this is most of the win.
2. **`GOMEMLIMIT=48MiB`.** Without a soft limit Go's GC lets the heap double
   before collecting. With it, the GC collects aggressively instead of growing.
3. **Cap the op log.** Unbounded append of every operation is the one real leak
   here — ring buffer of N, or stream JSONL to stdout and hold nothing.
4. **`GOMAXPROCS=1`.** Fewer OS threads, less stack, lower pid count.
5. `sync.Pool` read buffers, `Op` passed by value, no background tickers.

---

## Phases

The dashboard lands right after the control core; the SQL DB is the first
emulator, before the cache. Each phase is independently shippable and testable.

| Phase | Deliverable | Depends on |
|---|---|---|
| P0 | supervisor (`emu run -- <cmd>`) | — |
| P1 | control core (`Op`, interceptor, rules, op log, `ctl`) | P0 |
| P2 | control dashboard | P1 |
| P3 | **SQL DB on 5432** | P1 |
| P4 | Redis on 6379 | P1 |
| P5 | queue on 5672 | P1 |
| P6 | document DB on 27017 | P1 |
| P7 | rce-service integration | P3 |

The dashboard lands early, right after the control core, so every emulator after
it is developed and exercised through a real UI instead of ad-hoc scripts.

P4–P6 only depend on P1, so they can be built in any order — or in parallel —
once the core seam is proven by P3.

### P0 — supervisor skeleton

`emu-service/` Go module. `emu run -- <cmd>` spawns the child, forwards
stdout/stderr, propagates the exit code, reaps on signal. No emulators yet.

**Done when:** the RCE sandbox runs a Python script through `emu` with identical
output and exit code to today, **and `docker stats` gives us the idle RSS of the
supervisor** — the baseline every later phase is measured against.

### P1 — control core

- `Op` and the `Interceptor` seam
- rule engine: `match` / `after` / `times` / `when` → `error` `delay` `drop_conn` `cap`
- op log with logical ordinals
- config loader (seed + rules)
- `emu ctl` over a Unix socket, behind `--dev-control-socket` (dev only; a
  lesson run has no control channel — see the threat model)

No protocol code in this phase. The rule engine is tested against synthetic
`Op`s, not against a real client.

**Done when:** unit tests cover every action and the arm/fire counting, and `ctl`
adds a rule to an already-running process.

### P2 — control dashboard

The tool we develop every later emulator with: seed a service, arm a fault, fire
an operation at it, watch the op log react. Built right after the control core so
P3–P6 are never developed blind.

- pick which services to start, and seed them
- add / edit / remove fault rules against a running emulator
- fire test operations at each service and show the response
- stream the op log live, marking which operations were faulted

**This phase needs a dev-mode control channel.** In the sandbox the control plane
does not exist at all: any socket the controller could reach inside the sandbox
is one the student could reach too. So `emu` grows `--dev-control-bind :9100`, an
HTTP control plane for an `emu` running **locally, outside the sandbox**, where
there is no untrusted child. The dashboard talks to that. rce-service never
passes the flag, and no lesson run ever has a control channel.

**Done when:** with only P1 built, the dashboard can add a fault rule to a
locally-running `emu` and show the op log. It then grows one panel per emulator
as P3–P6 land, and is complete when every emulator can be seeded, faulted, and
exercised from it.

### P3 — SQL DB (first emulator)

Postgres wire on `127.0.0.1:5432` via `pgproto3`, fronting an in-memory
`modernc.org/sqlite`. Seed = SQL statements from config. `psycopg` connects
unmodified.

This is the riskiest phase, and putting it first is the point — it proves the
codec/interceptor/backend seam against the hardest protocol we have. Concretely:

1. **Handshake.** Reject `SSLRequest` with `'N'` (psycopg defaults to
   `sslmode=prefer` and will try), then `AuthenticationOk` → `ParameterStatus` →
   `BackendKeyData` → `ReadyForQuery`.
2. **Both query protocols.** The simple `Query` message *and* the extended
   `Parse`/`Bind`/`Describe`/`Execute`/`Sync` flow — psycopg3 uses the extended
   path for anything parameterised, so simple-only will not work.
3. **Type mapping.** SQLite's dynamic types → pg OIDs in `RowDescription`. Get
   `int4`/`text`/`bool`/`timestamp` right; everything else can be `text` in v1.
4. **Op extraction.** `sql.QUERY`, `sql.COMMIT`, `sql.ROLLBACK`, `sql.CONNECT`
   handed to the interceptor before execution.

**Done when:** a script inserts and reads rows through `psycopg`, and a
`sql.COMMIT after:3 times:1` rule makes exactly the third commit fail the way a
real serialization failure does — with the transaction's writes actually absent
afterwards, not just an error raised.

#### Why an embedded engine and not canned responses

The control layer mocks **behaviour** (this commit fails, this query is slow).
Something still has to answer **semantics** — evaluate the join, the `GROUP BY`,
the `HAVING`. With canned per-query responses a student can write a wrong query
and get the right answer, which kills the feedback loop the lessons exist to
create, and every new lesson means hand-authoring fixtures forever.

`modernc.org/sqlite` is pure Go — no CGO, no daemon, no socket, no container.
It is a library that evaluates SQL inside `emu`, not a database we deployed.
Students see Postgres on 5432 and never know it is there.

**Dialect: Postgres + SQLite.** SQLite lacks `ILIKE`, arrays, `DISTINCT ON`, and
schemas/`search_path`, and is dynamically typed, so Postgres-specific syntax will
bite. Accepted for now because Postgres is what the rest of the stack teaches.
The escape hatch if the gaps hurt in practice: MySQL wire backed by
`dolthub/go-mysql-server`, a fuller pure-Go SQL engine — a P3 rewrite, not a
core change.

### P4 — Redis

`miniredis` behind the interceptor on `127.0.0.1:6379`. Seeding = keys from
config.

**Done when:** a script using `redis-py` reads seeded keys, and a
`redis.SET after:2` rule makes exactly the third `SET` raise.

### P5 — queue

AMQP 0-9-1 on `127.0.0.1:5672` over in-memory queues, so `pika` connects
unmodified. This is where the interesting faults live: depth caps
(`when: {depth_gte: N}` → publish rejected), redelivery, ack timeouts.

**Done when:** a publish/consume/ack round trip works, and a depth cap makes the
101st publish fail while the first 100 succeed.

### P6 — document DB

Mongo wire on `127.0.0.1:27017` over an in-memory document store, enough for
`pymongo`'s `insert_one` / `find` / `update_one`. No aggregation pipeline in v1.

**Done when:** `pymongo` round-trips documents and a `doc.insert` fault fires.

### P7 — rce-service integration

Build `emu` in CI, publish it into the named volume, mount read-only, wrap the
run command, pass `config.json` through the execution request contract, surface
the op log in the result.

Can start as soon as P3 is green — it does not wait on P4–P6.

Sandbox limits must move (`rce_service/config.py`):

| Limit | Now | Needs | Why |
|---|---|---|---|
| `pids` | 10 | 32 | measured 9 tasks for emu + a shell, vs 1 for python alone |
| `memory` | 128 MB | 192 MB | emulator state shares the cgroup with the student process |
| `time` | 10 s | 30 s | multi-service lessons are slower |

Env for the emu process: `GOMAXPROCS=1`, `GOMEMLIMIT=48MiB`.
`read_only=True` stays — emulator state lives in the `/tmp` tmpfs.

**Measured in P0** (`emu-service/verify-sandbox.sh`, real sandbox posture):

| | tasks | emu threads | RSS |
|---|---|---|---|
| python alone (today) | 1 | — | — |
| emu + child, default `GOMAXPROCS` | 9 | 7 | 5.5 MB |
| emu + child, `GOMAXPROCS=1` | 6 | 5 | — |

Two corrections to earlier estimates in this plan. `pids_limit: 10` does **not**
fail outright — a trivial script runs fine at 9 tasks. But it leaves one slot
spare, so any student thread or subprocess dies, which is why it still has to
rise. And emu idles at ~5.5 MB rather than the 8-12 MB assumed above, so the
192 MB figure is conservative; revisit it once P3 adds sqlite rather than now.

---

## Explicitly out of scope for v1

Replication, clustering, transactions across two emulators, persistence between
runs, Kafka. Add them only when a lesson needs one.

---

## Appendix — the network layer, wired

```
emu-service/
  main.go              wiring: config -> emulators -> listeners -> supervise
  supervise.go         spawn student code as a child, stream output, exit code
  net.go               Protocol / Session / Backend + the universal serve loop
  control/
    interceptor.go     Before(Op) Verdict — the one control point
    rules.go           match / after / times / when -> error|delay|drop_conn|cap
    oplog.go           logical-ordinal op log
    socket.go          dev-only control socket, serves `emu ctl`
  proto/
    pgwire/            P3
    resp/              P4
    amqp/              P5
    mongowire/         P6
  backend/
    sqlite/  kv/  queues/  docs/
```

### net.go — protocol-agnostic

```go
// A Protocol owns a port and turns an accepted socket into a Session.
type Protocol interface {
	Name() string
	Port() int
	Accept(net.Conn) (Session, error) // handshake completes here
}

// A Session is per-connection: it decodes Ops and writes replies. Per-connection
// because pg's extended query protocol must remember prepared statements for
// the life of the socket.
type Session interface {
	Next() (Op, error) // io.EOF ends the connection
	Reply(Result) error
	Fail(error) error // protocol-correct error frame
	Close() error
}

// A Backend actually executes.
type Backend interface {
	Exec(Op) (Result, error)
	Seed(any) error
}

type Emulator struct {
	Proto   Protocol
	Backend Backend
}
```

The universal serve loop. Every protocol reuses it verbatim; adding a protocol
never touches this file.

```go
func (e *Emulator) serve(ln net.Listener, ic *control.Interceptor) {
	for {
		c, err := ln.Accept()
		if err != nil {
			return // listener closed during teardown
		}
		go e.handle(c, ic)
	}
}

func (e *Emulator) handle(raw net.Conn, ic *control.Interceptor) {
	defer raw.Close()

	sess, err := e.Proto.Accept(raw)
	if err != nil {
		return
	}
	defer sess.Close()

	for {
		op, err := sess.Next()
		if err != nil {
			return
		}
		op.Emulator = e.Proto.Name()

		// THE control point. Every operation in the system funnels through here.
		v := ic.Before(op)

		if v.Delay > 0 {
			time.Sleep(v.Delay)
		}
		switch {
		case v.DropConn:
			return // student sees a dead socket
		case v.Err != nil:
			sess.Fail(v.Err) // backend never sees the op
		default:
			res, err := e.Backend.Exec(op)
			if err != nil {
				sess.Fail(err)
				continue
			}
			sess.Reply(res)
		}
	}
}
```

### main.go — wiring

```go
// Only what the lesson declares is ever constructed or bound.
var protocols = map[string]func() *Emulator{
	"postgres": func() *Emulator { return &Emulator{Proto: pgwire.New(), Backend: sqlite.New()} },
	"redis":    func() *Emulator { return &Emulator{Proto: resp.New(), Backend: kv.New()} },
	"queue":    func() *Emulator { return &Emulator{Proto: amqp.New(), Backend: queues.New()} },
	"mongo":    func() *Emulator { return &Emulator{Proto: mongowire.New(), Backend: docs.New()} },
}

func main() {
	flag.Parse()
	cfg := config.MustLoad(*configPath)

	log := oplog.New(cfg.LogLimit)
	ic := control.New(cfg.Faults, log)

	for _, name := range cfg.Services {
		build, ok := protocols[name]
		if !ok {
			fatalf("unknown service %q", name) // fail loudly
		}
		e := build()

		if err := e.Backend.Seed(cfg.Seed[name]); err != nil {
			fatalf("seeding %s: %v", name, err)
		}
		ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", e.Proto.Port()))
		if err != nil {
			fatalf("binding %s: %v", name, err)
		}
		defer ln.Close()

		go e.serve(ln, ic)
	}

	// Dev only, and never from config — a lesson run gets no control channel.
	if cfg.DevControlSocket != "" {
		go control.ServeSocket(cfg.DevControlSocket, ic)
	}

	code := supervise(flag.Args()) // spawn student code, stream output, wait
	log.DumpTo(os.Stdout)
	os.Exit(code)
}
```

### The finished product

Lesson author writes `config.json`:

```json
{
  "services": ["postgres", "redis"],
  "seed": {
    "postgres": [
      "CREATE TABLE accounts (id INT PRIMARY KEY, balance INT)",
      "INSERT INTO accounts VALUES (1, 100), (2, 50)"
    ],
    "redis": { "rate:1": "0" }
  },
  "faults": [
    { "match": "postgres.COMMIT", "after": 2, "times": 1, "action": "error",
      "message": "could not serialize access due to concurrent update" }
  ]
}
```

Student writes ordinary code — real drivers, real connection strings, no shims:

```python
import psycopg, redis

db = psycopg.connect("postgresql://app@127.0.0.1:5432/app")
cache = redis.Redis(host="127.0.0.1", port=6379)

for i in range(3):
    with db.transaction():
        db.execute("UPDATE accounts SET balance = balance - 10 WHERE id = 1")
    cache.incr("rate:1")
    print(f"transfer {i} ok")
```

They see:

```
transfer 0 ok
transfer 1 ok
psycopg.errors.SerializationFailure: could not serialize access due to concurrent update
```

`balance` is 80, not 70 — the third transaction genuinely rolled back. The lesson
is that they did not write a retry.

Mid-run control, against a locally-run `emu` only — never a lesson container:

```bash
emu ctl fault add --match 'redis.*' --action delay --ms 250
```

The graded artifact, on stdout after the run:

```json
{"emu_oplog":[
  {"n":1,"emu":"postgres","op":"CONNECT"},
  {"n":4,"emu":"postgres","op":"COMMIT"},
  {"n":9,"emu":"postgres","op":"COMMIT","fault":"error"},
  {"n":10,"emu":"redis","op":"INCR","key":"rate:1"}
]}
```

The op log is what lets lessons grade **behaviour** rather than stdout — "did
they retry the failed commit?" is answerable from it.
