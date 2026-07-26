# Blessed-client compatibility matrix

The emulator's entire premise is that a **real client library, unmodified**, cannot
tell it apart from the real thing. That is not a property you can unit-test — it is a
property of `redis-py`'s and `ioredis`'s actual behaviour against actual bytes. So it
is a CI gate.

**The matrix is the contract.** A caching lesson may only hand a student a client
library that is proved here. Adding a language to a lesson means adding a script to
this directory first.

| Client | Script | Language |
|---|---|---|
| [`redis-py`](https://github.com/redis/redis-py) | `cache_aside.py` | Python |
| [`ioredis`](https://github.com/redis/ioredis) | `cache_aside.mjs` | Node |

## Run it

```sh
./compat/run.sh                    # build, boot the emulator, run every client
CANNAE_PORT=6380 ./compat/run.sh   # if something already owns the default
```

It builds `cannae`, boots `--infra cache:16379` with the control plane on `:19900`,
and runs each script against it. CI runs exactly this (`.github/workflows/cannae-service.yml`).

## What each script proves

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

## Two things worth knowing

**Client libraries chatter.** `redis-py` sends `CLIENT SETINFO` on connect; `ioredis`
sends `INFO` for its ready check. That traffic is real and the op log records it
faithfully — so a grader filters the log to the data ops the student's own code
issued. Both scripts show that filter (`LESSON_OPS`).

**`/reset` retires live sockets** so it can safely recycle connection ids. A client
built before the reset would find its connection dropped, which is why every stage
resets, seeds, and arms its rules *before* connecting — the same order the harness
uses around a student's code.
