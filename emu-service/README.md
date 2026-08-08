# emu-service

A single static Go binary that runs inside the existing no-network code execution
container and serves infrastructure emulators — a SQL DB, cache, queue, and
document DB — on loopback, behind a control layer that can make any operation
fail on demand.

Plan and phase breakdown: [`../plans/emu-service.md`](../plans/emu-service.md)

## Current state — every phase P0–P7 has landed

The supervisor, the control layer every emulator sits behind, the tool the
emulators are developed with, every emulator the plan calls for — Postgres on
`127.0.0.1:5432`, Redis on `127.0.0.1:6379`, an AMQP 0-9-1 broker on
`127.0.0.1:5672`, and MongoDB on `127.0.0.1:27017` — and the integration that puts
all of it on the real execution path. Each emulator plugs into the same seam, and
only what a lesson declares is ever constructed or bound.

```
emu run [flags] -- <command> [args...]   run <command>, supervised
emu dev [flags]                          serve the dashboard, no child process
emu ctl <command> --socket <path>        drive a locally-running emu (dev only)
emu install <path>                       copy this binary to <path>
emu help                                 show usage
```

## The SQL database

A lesson declares it, seeds it with SQL, and student code connects with an
ordinary connection string and an ordinary driver:

```json
{
  "services": ["postgres"],
  "seed": {
    "postgres": [
      "CREATE TABLE accounts (id INT PRIMARY KEY, balance INT)",
      "INSERT INTO accounts VALUES (1, 100), (2, 50)"
    ]
  },
  "faults": [
    { "match": "postgres.COMMIT", "after": 2, "times": 1, "action": "error",
      "message": "could not serialize access due to concurrent update" }
  ]
}
```

```python
import psycopg

db = psycopg.connect("postgresql://app@127.0.0.1:5432/app")
for transfer in range(3):
    with db.transaction():
        db.execute("UPDATE accounts SET balance = balance - 10 WHERE id = 1")
```

The third `COMMIT` raises `psycopg.errors.SerializationFailure`, and `balance` is
80 rather than 70 — the transaction genuinely rolled back. The lesson is that they
did not write a retry, and the op log is where "did they?" is answered.

### What speaks to what

```
:5432 ─ accept ─→ pgwire ─→ Op{postgres.COMMIT} ─→ Interceptor ─→ sqlite
                  (decode)                        (fault?)       (execute)
                     ↑                                              │
                     └──────────── encode reply ────────────────────┘
```

`internal/emulator` owns that loop and nothing else does; `pgwire` is the only
package that knows about the Postgres protocol and `sqlitedb` the only one that
knows about SQLite. The cache below is the same picture with `resp` and `kv` in
those two boxes, the queue is the same again with `amqp` decoding and `queues`
executing, and the document database the same once more with `mongowire` and
`docstore`. None of the three touched the serve loop or the control layer.

### Why a real engine rather than canned responses

The control layer mocks *behaviour* — this commit fails, this query is slow.
Something still has to answer *semantics*: evaluate the join, the `GROUP BY`, the
`HAVING`. With canned per-query responses a student can write a wrong query and
get the right answer, which kills the feedback loop the lessons exist to create.

`modernc.org/sqlite` is pure Go — no CGO, no daemon, no socket, no container. It
is a library evaluating SQL inside `emu`, not a database that was deployed.

The database is a file in the temp directory rather than `:memory:`, and the
reason is concurrency. SQLite's shared-cache in-memory mode is the only in-memory
mode two connections can both see, and it has no MVCC: a reader waits on a
writer's open transaction *indefinitely*, so a student holding a transaction on
one connection while reading on another would hang until the sandbox timed them
out. WAL on a file gives readers a snapshot, which is what Postgres does and what
the lesson describes. Inside the sandbox `/tmp` is a tmpfs, so this is still
memory: nothing reaches a disk and nothing survives the run.

### Operations a rule can match

| Kind | From |
|---|---|
| `postgres.CONNECT` | a completed handshake, carrying a `connections` gauge — how many were already open, so `when: {connections_gte: 10}` refuses the eleventh |
| `postgres.SELECT` `INSERT` `UPDATE` `DELETE` | the statement's leading keyword |
| `postgres.BEGIN` `COMMIT` `ROLLBACK` | likewise, including `START`, `END`, and `ABORT` |
| `postgres.QUERY` | everything else — DDL, `PRAGMA`, a CTE |

The plan named only `QUERY`, `COMMIT`, `ROLLBACK`, and `CONNECT`. Splitting the
DML verbs out costs nothing and "fail the third INSERT" is a lesson somebody will
want; `postgres.*` still catches all of them.

A faulted operation never reaches the engine, and a faulted `COMMIT` rolls its
transaction back — an exception the student can catch while the rows landed anyway
teaches the opposite of the lesson.

### What the client is told, and why it matters

A driver reacts to the SQLSTATE, not the sentence. psycopg turns `40001` into
`SerializationFailure` and `23505` into `UniqueViolation`; the same words under a
code it does not recognise are just a string.

- **An injected fault defaults to `40001`,** serialization failure, because that is
  the failure a Postgres client is written to retry. A rule may name another with
  `"code"`: `53300` for too many connections, `40P01` for a deadlock.
- **Engine failures carry their own.** SQLite's result codes are mapped onto the
  SQLSTATEs Postgres uses for the same thing, and where SQLite reports only
  "SQL logic error" the sentence is the only evidence there is — `no such table`
  becomes `42P01`, `syntax error` becomes `42601`.
- **A statement that fails inside a transaction aborts the block.** Every later
  statement gets `25P02` until the `ROLLBACK`, which SQLite would not do on its own
  and which is exactly what a lesson about error handling is about.

### Dialect: Postgres syntax, SQLite semantics

Accepted, because Postgres is what the rest of the stack teaches. SQLite has no
`ILIKE`, no arrays, no `DISTINCT ON`, no schemas or `search_path`, no `::` casts,
and no exact `NUMERIC` — a decimal parameter arrives as a float. Where the two
disagree the statement fails loudly with `42601` rather than doing something
surprising: `$1::text` is rewritten to `?1::text` before the engine sees it,
precisely so that it reads as "unrecognized token" instead of SQLite silently
taking `$1::text` for a parameter *named* `1::text`.

The escape hatch if the gaps hurt in practice is MySQL wire over
`dolthub/go-mysql-server`, a fuller pure-Go engine — a rewrite of `pgwire` and
`sqlitedb`, not a change to anything they sit between.

### Two things emu will not pretend about

- **It cannot describe a statement it has not run.** A result's shape is something
  a planner knows; SQLite reports a query's columns only by executing it, and
  running a client's statement to answer a question about it is not something a
  server may do. `Describe(statement)` is answered with the parameter types and
  `NoData`; the portal's own `Describe` carries the columns, which is what psycopg,
  node-postgres, and every `libpq` `ExecPrepared` ask for. A driver that instead
  caches the statement description — pgx's default mode — sees no columns.
- **It returns results in text format only,** and says `0A000` to a client that
  asks for binary. Binary *parameters* are decoded, because psycopg sends integers
  that way whether or not anyone asked.

## The cache

Same shape, one port along. A lesson declares it, seeds it with keys, and student
code connects with an ordinary client:

```json
{
  "services": ["redis"],
  "seed": {
    "redis": { "rate:1": "0", "recent": ["a", "b"], "session:7": { "user": "ada" } }
  },
  "faults": [
    { "match": "redis.SET", "after": 2, "times": 1, "action": "error",
      "message": "cache write refused" }
  ]
}
```

```python
import redis

cache = redis.Redis(host="127.0.0.1", port=6379)
for attempt in range(3):
    cache.set(f"key:{attempt}", attempt)
```

The third `set` raises `redis.exceptions.ResponseError`, and `key:0` and `key:1`
are in the cache while `key:2` is not.

```
:6379 ─ accept ─→ resp ─→ Op{redis.SET} ─→ Interceptor ─→ kv
                 (decode)                  (fault?)      (execute)
                    ↑                                      │
                    └──────────── encode reply ────────────┘
```

### Why not miniredis

The plan named `github.com/alicebob/miniredis`, and it does not fit. Three
reasons, each sufficient on its own:

- **It cannot be driven in-process.** `Miniredis.start` is unexported and takes a
  `*server.Server`, which only `server.NewServer(addr)` builds — and that binds a
  TCP listener before a single command is registered. There is no way to get a
  command-registered miniredis without a socket of its own, and a second listener
  on loopback is one student code reaches directly, skipping `Interceptor.Before`
  entirely. Loopback exists under `--network none` and the student shares emu's
  uid, so that is the fault-disarming hole the threat model exists to close.
- **Its one hook is in the wrong place.** `Server.SetPreHook` fires inside
  miniredis's dispatch loop on miniredis's listener. Taking it would put emu's
  control point in two places, leave `fleet` unable to bind 6379, and leave
  `redis.CONNECT` with nowhere to come from — a pre-command hook has no accept
  hook beside it.
- **Its TTLs do not decrease.** "Since miniredis is intended to be used in
  unittests TTLs don't decrease automatically", says its README; time moves only
  when a test calls `FastForward`. A cache whose keys never expire is not a cache
  lesson.

Its direct API (`Set`, `Get`, `Incr`, …) sidesteps the first two and is a key
space rather than command semantics: no arity checks, no `SET … NX EX`, no `SCAN`
cursor, no `MGET`, no Redis error strings, and still no clock. `internal/kv` would
have had to be written anyway, on top of 2.0 MB of linked library. It is 0.1 MB
instead.

This is the opposite call from `sqlitedb`, and for a reason that survives the
difference: what an embedded SQL engine answers is *semantics* — the join, the
`GROUP BY` — which is weeks of work and the thing a student's wrong query has to
be caught by. A cache has no semantics to speak of. `GET` returns what `SET` put
there.

### Commands

```
PING ECHO SELECT INFO DBSIZE FLUSHDB
DEL EXISTS EXPIRE TTL TYPE KEYS SCAN
GET SET SETEX GETSET MGET MSET APPEND STRLEN INCR DECR INCRBY DECRBY
HSET HGET HDEL HGETALL HKEYS HVALS
LPUSH RPUSH LPOP RPOP LRANGE LLEN
SADD SREM SMEMBERS SISMEMBER SCARD
```

Deliberately that and no more: a verb emu half-implements is worse than one it
refuses, because the student debugs their own code instead of the emulator's.
Everything else gets Redis's own `unknown command`, with the arguments quoted back
the way Redis quotes them.

`HELLO`, `CLIENT`, and `COMMAND` are answered by `resp` and never reach the cache
or the op log. Those are the driver talking — redis-py sends two `CLIENT SETINFO`
on every connect — and a graded artifact buried under a driver's bookkeeping is no
better here than it was for `DEALLOCATE` on the SQL side.

`KEYS`, `SCAN`, `HGETALL`, `HKEYS`, `HVALS`, and `SMEMBERS` come back sorted where
Redis returns them in hash order. What sorting costs is the illusion that emu's
arbitrary order means something; what it buys is a lesson that prints the same
thing twice.

### Operations a rule can match

| Kind | From |
|---|---|
| `redis.CONNECT` | the first command that is not driver bookkeeping, carrying a `connections` gauge |
| `redis.GET` `SET` `INCR` `HSET` … | one per command verb, with `Target` the key it names |

`redis.*` still catches all of them, so "delay every cache operation" is one rule
and "fail the third SET" is another.

`CONNECT` is reported on the first real command rather than at `accept`, and the
reason is that a refusal has to be something the student can see. RESP has no
handshake, so there is no frame at which a client waits to be told it may
proceed — and both redis-py and go-redis are written to swallow errors on their
own setup commands, so a refusal delivered there would vanish.

### What the client is told

Wrong arity, wrong type, a bad `SET` option, an overflowing `INCR`, and an unknown
command all produce Redis's exact wording, because a student debugging against emu
who sees anything else is learning something that will not transfer.

An injected fault defaults to the `ERR` prefix. Redis has no SQLSTATE registry:
redis-py maps a handful of prefixes — `WRONGTYPE`, `OOM`, `BUSY`, `READONLY`,
`NOSCRIPT` — to their own exception classes and everything else to a plain
`ResponseError`. `ERR` is the one that raises what a student's `except
redis.RedisError` catches; a lesson about an evicting cache names `OOM` with the
rule's `"code"` and gets `OutOfMemoryError` instead.

### Both protocol versions, because the default moved

RESP2 was going to be enough. It is not: **redis-py 8 defaults to RESP3**, opens
with `HELLO 3`, and raises rather than falling back — so a RESP2-only emu would
need `protocol=2` in the lesson's client, which is exactly the shim this phase
exists to avoid. go-redis opens with `HELLO 3` too, though it does fall back.

The gap turned out to be three frames rather than a protocol: null is `_` instead
of `$-1`, a map is `%` instead of a flattened array, and `HELLO` has to answer with
the version it was asked for. Sets, doubles, big numbers, verbatim strings, and
push frames all belong to commands emu does not have. A client asking for neither
2 nor 3 gets `NOPROTO`, which is what a Redis too old for it says.

### Seeding

A string seeds a string, a JSON array seeds a list, a JSON object seeds a hash.
Sets are deliberately not seedable: an array already means a list, and inventing a
tagged encoding to tell the two apart would cost a lesson author more than the one
`SADD` it saves.

Seed data lands in database zero. `SELECT` reaches the other fifteen, and which
one a connection is in is the only state the cache keeps per connection.

### Two things the cache will not pretend about

- **`SCAN` returns everything in one pass** and reports the iteration complete.
  Redis itself does that whenever the table is small, so it is a legal `SCAN`
  rather than a shortcut — and a cursor emu never issues is one no client can hand
  back. The point of writing `scan_iter` against emu is that the same code is right
  against a production Redis with a million keys, not that emu has a million.
- **Expiry is lazy.** A key dies when something next looks at it, which is what
  Redis does and what keeps emu free of the background ticker the memory budget
  rules out. `DBSIZE` and `KEYS` sweep, so nothing expired is ever counted.

## The message queue

AMQP 0-9-1 on `127.0.0.1:5672`. A lesson declares the topology and what is
already waiting in it, and student code connects with `pika` and nothing else:

```json
{
  "services": ["queue"],
  "seed": {
    "queue": {
      "exchanges": [{ "name": "events", "type": "topic" }],
      "queues": [
        { "name": "orders",
          "bind": [{ "exchange": "events", "routing_key": "order.*" }],
          "messages": ["{\"id\": 1}", "{\"id\": 2}"] }
      ]
    }
  },
  "faults": [
    { "match": "queue.publish", "when": { "depth_gte": 100 }, "action": "error",
      "message": "the queue is full" }
  ]
}
```

```python
import pika

conn = pika.BlockingConnection(pika.ConnectionParameters("127.0.0.1"))
channel = conn.channel()
channel.confirm_delivery()

for _ in range(200):
    channel.basic_publish("", "orders", b"another one")
```

The hundred and first publish raises `pika.exceptions.ChannelClosedByBroker`
carrying reply code 506, and the queue holds exactly a hundred messages. The
lesson is that they did not apply backpressure.

Seed messages are bodies published on the default exchange under their queue's
name. Properties are a publisher's business, and a lesson that needs one can
publish the message itself in a line of setup — which is also the version a
student can read.

### Operations a rule can match

| Kind | From |
|---|---|
| `queue.CONNECT` | a completed handshake, carrying a `connections` gauge |
| `queue.publish` | `Basic.Publish`, with the routing key as its target |
| `queue.get` `consume` `cancel` | `Basic.Get`, `Basic.Consume`, `Basic.Cancel` |
| `queue.ack` `nack` | `Basic.Ack`, and both `Basic.Nack` and `Basic.Reject` |
| `queue.qos` | `Basic.Qos` |
| `queue.declare` `bind` `purge` `delete` | the `Queue` class |
| `queue.exchange_declare` | `Exchange.Declare` |

Every one of them carries `depth`, `unacked`, and `consumers` for the queue it
is aimed at, read **before** the operation runs — which is the only moment at
which the answer can still change what happens to it. A publish that fans out
reports the fullest queue it would reach, because a depth cap is asking whether
any destination is full. An operation that names no queue reports zeros, so a
rule gated on a depth can never fire on one.

An injected fault defaults to reply code **506**, resource error. AMQP has no
equivalent of the serialization failure that Postgres clients retry on their
own, so the honest default is "the broker could not do this for want of
resources" — which is exactly what a depth cap is. A rule may name any other
with `"code"`.

### Why publisher confirms matter more here than they do in production

`Basic.Publish` is asynchronous: the client does not wait, so a broker has
nowhere to put a refusal except a channel exception, which the client notices at
its next synchronous call. Against emu that means a lesson which publishes in a
tight loop sees the hundredth-and-first refusal a publish or two later.

`channel.confirm_delivery()` fixes it, and it is what a reliability lesson would
do anyway: the client then waits for each publish to be acknowledged, so the
refusal lands on the publish that caused it. Both paths work; only one of them
is deterministic.

### What is emulated, and what is accepted and ignored

Direct, fanout, and topic exchanges route; the default `""` exchange delivers to
the queue its routing key names. Round-robin between consumers, `Basic.Qos`
prefetch, redelivery marking, requeue on nack, and requeue of everything a
dropped connection was holding all behave as a broker's do — a student whose
worker pool silently received every message twice has no feedback loop left.

Declared and then ignored: `durable`, `exclusive`, `auto-delete`, `internal`,
`if-unused`, `if-empty`, `no-local`, and `immediate`. None of them can mean
anything in a broker that is one process and dies with the run, and refusing
them would fail lessons over a distinction emu does not implement either way.
Redeclaring a queue with different flags is likewise accepted, though
redeclaring an *exchange* as another kind is refused: a fanout that quietly
stayed a direct would grade everyone on the wrong routing.

Not implemented, and refused rather than ignored: headers exchanges,
`Queue.Unbind`, `Exchange.Delete`, transactions, `Basic.Recover`, a prefetch
counted in bytes, and consumer cancel notification — which is advertised as
absent in the server capabilities, so a client that would have relied on being
told its queue was deleted knows not to.

### Two things worth knowing before changing it

- **A field table is carried as the bytes it arrived as.** emu has no reason to
  look inside a message's headers or a client's properties, and moving the bytes
  through is both smaller than a codec for AMQP's fourteen optional content
  properties and lossless in a way that codec would not be. The same goes for
  the content header's whole property block.
- **Delivery tags are unique per connection, not per channel.** AMQP only asks
  that they increase within a channel, and one map beats one map per channel.
  `multiple` acknowledgements are still scoped to the channel that sent them.

## The document database

A lesson declares it, seeds it with documents, and student code connects with an
ordinary `MongoClient` and no shim:

```json
{
  "services": ["mongo"],
  "seed": {
    "mongo": {
      "orders": [
        {"sku": "widget", "total": 50, "tags": ["new", "sale"]},
        {"sku": "gizmo", "total": 120, "tags": ["sale"]}
      ]
    }
  },
  "faults": [
    { "match": "mongo.insert", "after": 2, "times": 1, "action": "error",
      "message": "the write could not be applied due to a conflict" }
  ]
}
```

```python
from pymongo import MongoClient

orders = MongoClient("mongodb://127.0.0.1:27017").shop.orders
for attempt in range(3):
    orders.insert_one({"sku": f"batch-{attempt}"})
```

The third `insert_one` raises `pymongo.errors.OperationFailure` with code `112`,
and the first two documents are still there.

```
:27017 ─ accept ─→ mongowire ─→ Op{mongo.insert} ─→ Interceptor ─→ docstore
                   (decode)                        (fault?)       (execute)
                      ↑                                              │
                      └──────────── encode reply ────────────────────┘
```

### There is no engine to embed, so emu has one

`modernc.org/sqlite` answers SQL semantics for the SQL database. MongoDB has no
equivalent: there is no pure-Go document engine to link in. So the query
evaluator is emu's own — and it is small, which makes what it does *not* do the
thing that has to be loud.

Everything it cannot evaluate fails by name. A `$lookup`, a `$group` that is not
counting, an update operator it does not implement, a regular expression option
Go's `regexp` cannot express: each of them is answered with
`CommandNotSupported` and a sentence naming it. The failure that must be
impossible is emu returning a plausible answer to a question it did not ask.

Everything it *does* evaluate is evaluated properly. A wrong filter returns the
wrong documents, comparison operators bracket by BSON type the way MongoDB's do
(`{age: {$gt: 5}}` does not match `"old"`), equality reaches inside arrays
without being asked, and a filter for `null` finds the documents that do not have
the field at all.

### Operations a rule can match

| Kind | From |
|---|---|
| `mongo.CONNECT` | an accepted socket, carrying a `connections` gauge |
| `mongo.insert` `find` `update` `delete` | the command the driver sent |
| `mongo.getMore` `killCursors` | paging a cursor, and abandoning one |
| `mongo.count` `aggregate` | the two ways a client counts |
| `mongo.createIndexes` `listCollections` `listDatabases` `drop` `dropDatabase` | the rest |

Every collection-scoped operation carries a `documents` gauge — how many the
collection already held — so `when: {documents_gte: 100}` reads as a capacity.

`hello`, `isMaster`, `ping`, `buildInfo`, `getParameter`, and `endSessions` are
answered by the protocol and never become operations. They are what a driver does
to get a connection into a usable state, and a student is graded on what their
code did.

### What emu does not pretend about

- **There is one database.** A lesson seeds collections and never names a
  database, so `client.shop.orders` and `client.test.orders` are the same
  collection. `listDatabases` reports the one, called `emu`. A lesson that needs
  two namespaces uses two collections.
- **There are no indexes.** `createIndexes` succeeds and builds nothing; every
  query is a collection scan. That changes how long a lesson takes and nothing
  about what it returns.
- **There are no multi-document transactions.** `startTransaction` is not a
  command emu implements, and it says so. A faulted operation is simply one the
  store never saw, which is why the document backend has nothing for
  `Executor.Abort` to undo.
- **There is no aggregation framework** — but `count_documents` is an aggregate
  in every modern driver, so `$match`, `$skip`, `$limit`, `$count`, and the
  counting `$group` are evaluated and every other stage is refused by name.

### What the client is told

A driver reacts to the numeric code, not to the sentence: pymongo turns `11000`
into `DuplicateKeyError` and `43` into `CursorNotFound`.

- **An injected fault defaults to `112`,** `WriteConflict`, which is MongoDB's
  serialization failure and the write failure a client is written to notice.
- **A rule's `code` is read as a number.** A rule that spells the failure instead
  — `"code": "NotWritablePrimary"` — gets it back as the `codeName`, because a
  driver parses a non-numeric code as zero and reads zero as success.
- **A duplicate `_id` is a write error inside a successful command,** not a failed
  command, which is what makes `insert_many` report which document broke.

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
| services | What the config declared, and where each one is listening. |
| fault rules | Arm, disarm, and reset rules against the running process. |
| fire an operation | Drive the interceptor directly and see the verdict. |
| run a command | Start a child through the real supervisor and watch its output. |
| op log | Live, faulted rows marked, synthetic operations labelled. |

It polls `/api/state?since=N&output=M` every 600ms and gets only what it has not
seen. Server-sent events would be the textbook answer; a cursor over a bounded log
is a tenth of the moving parts and there is no reconnect or backpressure semantics
to get wrong.

### Firing operations by hand

A service whose emulator has not been built yet has nothing to send a real
operation to. The dashboard pushes a synthetic `Op` straight at the interceptor
instead, which is how the rule engine is meant to be exercised before a protocol
exists. Those entries are marked `synthetic` in the op log — without that, the log
could be read as evidence a client did something the operator did.

For a service that *is* listening, point a real client at the address the services
panel shows, and use the "run a command" panel to do it through the same
supervisor a lesson's child gets.

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
# a request with no emulators, unchanged
sh -c 'echo <code> | base64 -d > /tmp/app.py && python3 -u /tmp/app.py'

# a lesson that declares them
sh -c 'echo <config> | base64 -d > /tmp/emu-config.json &&
       echo <code>   | base64 -d > /tmp/app.py &&
       exec /emu/emu run --config /tmp/emu-config.json -- python3 -u /tmp/app.py'
```

The `exec` is not decoration: without it emu is a child of that shell rather than
PID 1, and every guarantee below about an untrusted child is gone.

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
| `code` | The protocol's own name for the failure, which is what makes a driver react rather than merely report. Postgres takes a SQLSTATE; absent leaves the emulator's default. |
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
- **rce-service is tested for it from its own side too.** The argv it builds is
  asserted to be exactly `run --config <path>` and nothing else, in
  `rce-service/tests/test_rce_security_invariants.py` — the file to read before
  adding a flag there.

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
  "services": ["postgres"],
  "seed": {
    "postgres": [
      "CREATE TABLE accounts (id INT PRIMARY KEY, balance INT)",
      "INSERT INTO accounts VALUES (1, 100), (2, 50)"
    ]
  },
  "faults": [
    { "match": "postgres.COMMIT", "after": 2, "times": 1, "action": "error",
      "message": "could not serialize access due to concurrent update" }
  ],
  "log_limit": 500
}
```

Only what `services` declares is ever constructed or bound — most of what keeps
emu small. Seed data is held as raw JSON until the backend that consumes it says
what shape it is: `postgres` reads a list of SQL statements applied in order,
`redis` an object of keys to values, `queue` a topology of exchanges and queues,
and `mongo` an object of collection name to documents — read as MongoDB's extended
JSON, so that `{"$oid": "..."}` seeds a real ObjectId rather than a string that
looks like one. Either way it is in place before any client can connect, and a
seed that will not load fails the run rather than the student.

The loader refuses anything that could not do what it appears to say: an unknown
service name, a service twice, seed data or a fault aimed at a service the lesson
never starts, and any field it does not know.

## How the binary reaches a lesson

rce-service mounts a named volume, `emu-bin`, **read-only** at `/emu` — the same
posture the package caches get, so the code being graded can run the binary and
never write it. The volume is populated at build time, never by the worker:

```sh
just publish-emu     # build the image, create emu-bin, install into it
docker compose up    # the same, via the one-shot emu-publisher service
```

Both come down to three commands, which CI runs too:

```sh
docker build -t emu:local emu-service
docker volume create emu-bin
docker run --rm -v emu-bin:/out emu:local install /out/emu
```

`emu install` exists because the shipped image is `FROM scratch` and has no shell:
there is no `cp` to run, so the binary copies itself. It writes a `.partial` and
renames, so a container mounting the volume mid-publish sees one whole binary or
the other, never half of one.

The lesson's config does **not** arrive as a bind mount. rce-service drives the
host Docker daemon from inside its own container, so a path it can write is not a
path that daemon could mount; the config is base64-decoded into the run
container's tmpfs alongside the student's code, exactly as the code already was.
emu reads it, arms the faults, and binds the ports before the child exists, so
nothing untrusted can touch it in time to matter.

## Exit codes

The child's own exit code is passed through untouched. Codes emu produces itself
follow the shell and `sysexits.h`, so a broken lesson reads like a familiar error:

| Code | Meaning |
|---|---|
| `1` | the control socket could not be opened, an emulator's port was already taken, or the op log could not be written |
| `2` | bad emu command line |
| `78` | the config is unusable (`EX_CONFIG`), including a service this build has no emulator for |
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
internal/emulator/     Protocol / Session / Backend and the one serve loop
internal/fleet/        service name -> a built, seeded, listening emulator
  queue.go             the AMQP broker's entry in that registry
internal/oplog/        the graded artifact
internal/pgwire/       the Postgres wire protocol
internal/sqltext/      the little that has to be read off a SQL statement
internal/sqlitedb/     SQL semantics, and SQLite errors as SQLSTATEs
internal/resp/         the Redis serialization protocol, RESP2 and RESP3
internal/kv/           cache semantics: the key space, expiry, Redis's own errors
internal/amqp/         the AMQP 0-9-1 wire protocol: framing, methods, channels
internal/mq/           the vocabulary amqp and queues share: message, delivery
internal/queues/       queues, exchanges, routing, deliveries not yet settled
internal/mongowire/    the MongoDB wire protocol: framing, handshake, commands
internal/mongocmd/     the little that has to be read off a command document
internal/docstore/     document semantics: filters, updates, cursors, BSON order
internal/supervise/    PID 1 duties: spawn, forward signals, reap, exit code
```

`fleet` is the only place that knows which services have an emulator, and it is
also where the ports are taken. Everything else is reusable across all four.
`mongocmd` is to the document database what `sqltext` is to the SQL one: the
vocabulary its protocol and its backend share, so neither has to learn the
other's job.

The queue is the one emulator whose codec is handed its backend rather than only
sitting in front of it, because a rule's `when` clause reads a queue's depth
before the operation runs and only the backend knows it.

## What it costs

Measured by `verify-sandbox.sh` under the real sandbox posture.

| | on disk | resident |
|---|---|---|
| P0, the supervisor alone | 2.7 MB | 5.3 MB |
| P2, with an HTTP server linked in | 6.1 MB | 5.4 MB |
| P3, with pgproto3 and SQLite | 10.3 MB | 5.9 MB |
| P4, with the cache as well | 10.4 MB | 5.5 MB |
| P5, with the message queue as well | 10.5 MB | 6.5 MB |
| P6, with the document database as well | 11.4 MB | 5.4 MB |
| P7, with `emu install` as well | 11.4 MB | — |

The disk column is the stacked binary at that phase, in MiB — the unit `du -h`
and `just build-emu` report; the last row is this branch's real binary,
11,911,330 bytes, and P7 accounts for 8 KB of it. Disk grew four times over across P0–P3 and resident
grew by half a megabyte, because code nothing calls is never paged in — which is
also why a build tag to strip the dashboard out of the lesson binary would buy
disk and nothing else. P4 and P5 add about 0.1 MB each, all of it emu's own code
and no library at all: the same cache built on miniredis would have added 2.0 MB
of library before writing any, and there is no Go server-side AMQP library to
depend on. P6 costs 0.9 MB and is the one that does link a library, `bson` — and
it is the same effect from the other side, costing *less* resident than the SQL
one, because a mongo-only lesson never pages SQLite in at all. The resident column
is not comparable row to row: each phase measured its own run, and the run that
saw 6.5 MB with the queue running saw 6.9 MB for the P3 config beside it. The
working budget in the plan is ~20 MB resident.

With the SQL emulator **seeded and in use** (P7, `GOMAXPROCS=1`,
`GOMEMLIMIT=48MiB`), against the whole sandbox cgroup rather than emu alone:

| | tasks | resident | cgroup `memory.peak` |
|---|---|---|---|
| `sleep` alone, no emu | 1 | 0.5 MB | 7.9 MB |
| emu + child, no config | 8 | 5.4 MB | 8.4 MB |
| emu + seeded postgres + child | 7 | 5.6 MB | 9.7 MB |
| the transfer lesson through `pg8000` | 6 | — | 23 MB |
| the same, plus 50,000 inserted rows | 7 | — | 57 MB |

A seeded SQL emulator costs **1.8 MB** and **one task**. The sandbox's 192 MB and
32 pids are therefore headroom for the *lesson's data*, not for emu — and a cap
costs nothing until a lesson uses it. `memory.peak` counts page cache, which is
why it reads above the resident figure for the same run.

## Development

```sh
just test-emu        # tests with a 100% coverage gate on internal/...
just lint-emu        # gofmt check + go vet
just build-emu       # static binary at emu-service/build/emu
just publish-emu     # that binary into the emu-bin volume the sandbox mounts

./verify-sandbox.sh  # every check above, under the real sandbox posture
```

The tests drive each codec with a real client over a real socket, because the only
question that matters about a wire protocol is whether the clients that speak it
are satisfied: `pgx` for `pgwire`, `go-redis` for `resp`, `amqp091-go` — the
RabbitMQ team's own client, and stricter about frames than pika is — for `amqp`,
and the MongoDB Go driver for `mongowire`. All four are test-only dependencies.
The one exception is that driver's `bson` package, which *is* linked into the
binary: BSON is a codec worth borrowing, where a document engine would have been a
semantics library worth refusing.

`resp` and `internal/amqp` are additionally driven with hand-written frames,
because a client library will never send a malformed one and the answer to a
malformed one is the difference between a student reading `Protocol error` and a
student watching a socket hang.

The tests bind ephemeral ports rather than 5432, 6379, 5672, and 27017: this
repository's own `docker-compose` already publishes them, and a suite that cannot
run while the app is up is a suite nobody runs. `verify-sandbox.sh` is where the
real ports meet real clients inside the sandbox: `redis-py`, `pika`, and `pymongo`
on Alpine, `psycopg` on a glibc image, and `pg8000` on the Alpine image lessons
actually run on — psycopg's binary wheels are manylinux, so pg8000 is what the
allowlist gives a student.

The static build is a hard requirement — the binary is mounted into whatever
image a lesson uses and must not depend on that image's libc. `just build-emu`
and the Dockerfile both assert the result is not dynamically linked.
