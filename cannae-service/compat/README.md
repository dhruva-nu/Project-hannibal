# Blessed-client compatibility matrix

The emulator's entire premise is that a **real client library, unmodified**, cannot
tell it apart from the real thing. That is not a property you can unit-test — it is a
property of `psycopg2`'s and `ioredis`'s actual behaviour against actual bytes. So it
is a CI gate.

**The matrix is the contract.** A lesson may only hand a student a client library that
is proved here. Adding a language to a lesson means adding a script to this directory
first.

| Emulator | Client | Script | Language |
|---|---|---|---|
| cache | [`redis-py`](https://github.com/redis/redis-py) | `cache_aside.py` | Python |
| cache | [`ioredis`](https://github.com/redis/ioredis) | `cache_aside.mjs` | Node |
| sql | [`psycopg2`](https://github.com/psycopg/psycopg2) | `banking.py` | Python |
| sql | [`SQLAlchemy`](https://www.sqlalchemy.org/) (on psycopg2) | `banking_sqlalchemy.py` | Python |
| sql | [`node-postgres`](https://node-postgres.com/) | `banking.mjs` | Node |

## Run it

```sh
./compat/run.sh                    # build, boot the emulators, run every client
CANNAE_PORT=6380 ./compat/run.sh   # if something already owns the default
```

It builds `cannae`, boots `--infra cache:16379,sql:15432` with the control plane on
`:19900`, and runs each script against it. One process serves both, which is how a
lesson declaring `infra: [redis, postgres]` runs them. CI runs exactly this
(`.github/workflows/cannae-service.yml`).

## What the cache scripts prove

Both run the same four stages, so a gap in one client shows up as a diff against the
other:

1. **`smoke`** — the command surface a caching lesson needs, driven through the
   client's own idiomatic API (`cache.setex(...)`, not a raw command string).
2. **`cache_aside`** — the milestone lesson from #134. `get_user_profile()` is written
   exactly as a student would write it, then graded **from the op log**: was the cache
   read *before* the backing store, and written *after* the miss? Does a hit issue no
   `SET` and leave the store untouched? Then the clock is advanced past the TTL and
   the fallback path is graded the same way.
3. **`forced_expiry_fault`** — the same miss, produced by an `expire_key` rule scoped
   to one key, proving an unrelated read does not consume it.
4. **`error_handling`** — a student's mistake raises the client's *native* exception
   (`redis.ResponseError`, an ioredis rejection) with the message real Redis returns,
   and the connection survives it.

## What the SQL scripts prove

All three run the banking milestone lesson from #135 — `transfer_money()`, graded from
`/state` and the op log — plus the surface it rests on:

1. **`smoke`** — the SQL a banking lesson needs, through the client's own API. Money
   must arrive as an exact decimal (`Decimal("1000.00")`, or the string
   node-postgres uses), never a float.
2. **`happy_path`** — the transfer works, *and* the op log shows both writes between
   `BEGIN` and `COMMIT`, each recorded with the transaction state it ran under. That
   second half is the grading signal: not "is the answer right" but "did they do it the
   way that survives a crash".
3. **`crash_between_the_two_writes`** — a `kill_connection` rule armed on the second
   `UPDATE`. With a transaction, the debit rolls back with the socket and the bank's
   total is unchanged. Without one, the debit committed on its own and 100.00 is gone —
   reproducibly, which is the whole point.
4. **`retryable_errors`** — an injected `40001` reaches the client as its own
   serialization-failure exception, poisons the transaction block, and the retry after
   it succeeds.
5. **`constraint_errors`** — a `CHECK`, a unique violation, a missing table: each
   arrives as the client's native exception carrying the real SQLSTATE, and the
   connection survives all of them.

**Why three clients for one emulator.** They exercise genuinely different code paths:

- **psycopg2** interpolates parameters itself and sends **simple** queries (`Q`).
- **node-postgres** uses the **extended** protocol — `Parse`/`Bind`/`Describe`/
  `Execute`/`Sync`, pipelined. It is the only script that proves that flow.
- **SQLAlchemy** fires **introspection probes on connect** before it will run any
  lesson SQL, and decides for itself when a transaction opens. `banking_sqlalchemy.py`
  has a `connects_at_all` stage precisely because that is what fails first when a probe
  is missing — and both stubs that exist for it (`pg_type`/`pg_namespace`, and
  `SHOW TRANSACTION ISOLATION LEVEL`) were added from *this suite failing*, never from
  speculation.

## Three things worth knowing

**Client libraries chatter.** `redis-py` sends `CLIENT SETINFO` on connect; `ioredis`
sends `INFO` for its ready check; every SQL driver wraps each statement in
`parse`/`bind`/`sync`. That traffic is real and the op log records it faithfully — so a
grader filters the log to the ops the student's own code issued. Every script shows
that filter (`LESSON_OPS`).

**An ORM's connect-time probes are chatter too, and they cannot be filtered by op
type** — SQLAlchemy's dialect initialisation is a handful of `SELECT`s in their own
transactions, indistinguishable in the log from a student's. So
`banking_sqlalchemy.py` brings the engine up and disposes its pool *before* the log is
reset. That is also how it looks in production: a connection pool is already warm by
the time a request arrives.

**`/reset` retires live sockets** so it can safely recycle connection ids. A client
built before the reset would find its connection dropped, which is why every stage
resets, seeds, and arms its rules *before* connecting — the same order the harness
uses around a student's code.
