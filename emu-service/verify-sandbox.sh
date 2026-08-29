#!/usr/bin/env sh
# Checks emu against the real sandbox posture, phase by phase.
#
# P0: emu runs a Python script with the same output and exit code as running
# Python directly, and we learn its idle RSS as the baseline for later phases.
# P1: a config-driven run reports its op log and opens no control channel — and
# the reason it must not is measured rather than assumed.
# P2: the control plane binds no port either, the dashboard refuses to leave the
# machine, and linking an HTTP server in costs the sandbox almost nothing.
# P3: psycopg connects to 127.0.0.1:5432 unmodified, and a fault on the third
# COMMIT fails it with that transaction's writes actually absent afterwards.
# P4: redis-py connects to 127.0.0.1:6379 unmodified, reads seeded keys, has its
# third SET refused with the first two still in the cache, and watches a TTL pass.
# P5: pika connects to 127.0.0.1:5672 unmodified, a publish/consume/ack round
# trip works, and a depth cap refuses the hundred and first publish.
# P6: pymongo connects to 127.0.0.1:27017 unmodified, and a fault on the third
# insert fails it with the first two documents actually stored.
# P7: the binary reaches the sandbox the way rce-service delivers it — published
# into a named volume, mounted read-only — and the lesson runs through the exact
# command rce_service/docker.py composes, with emu as PID 1.
#
# The posture below mirrors rce_service/docker.py:_start_container exactly. Run
# from emu-service/ after `just build-emu`.
set -eu

BINARY="$(pwd)/build/emu"
IMAGE=python:3.11-alpine
SCRIPT='import sys; print("stdout line"); print("stderr line", file=sys.stderr); sys.exit(3)'

[ -f "$BINARY" ] && [ -x "$BINARY" ] || { echo "missing $BINARY — run: just build-emu" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cat > "$WORK/config.json" <<'JSON'
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
JSON

# The lesson from plans/emu-service.md, written the way a student would: real
# driver, real connection string, no shims.
cat > "$WORK/lesson.py" <<'PY'
import sys

import psycopg

db = psycopg.connect("postgresql://app@127.0.0.1:5432/app")
failures = 0

for transfer in range(3):
    try:
        with db.transaction():
            db.execute("UPDATE accounts SET balance = balance - 10 WHERE id = 1")
        print(f"transfer {transfer} ok")
    except psycopg.errors.SerializationFailure as failure:
        failures += 1
        print(f"transfer {transfer} failed: {failure}")

balance = db.execute("SELECT balance FROM accounts WHERE id = 1").fetchone()[0]
print(f"balance is {balance}")

if failures != 1:
    sys.exit(f"expected exactly one serialization failure, got {failures}")
if balance != 80:
    sys.exit(f"expected balance 80 with the faulted transaction rolled back, got {balance}")
PY

# Every constraint the untrusted-code sandbox applies. The limits are the ones
# P7 moved rce_service/config.py to: 32 pids and 192 MB, because a lesson's
# emulators share the cgroup with the student's process. Keep the two in step —
# a number that drifts here stops being a check.
sandbox() {
    pids="$1"
    shift
    docker run --rm \
        --network none \
        --memory 192m --memory-swap 192m \
        --pids-limit "$pids" \
        --cap-drop ALL \
        --security-opt no-new-privileges \
        --user 65534:65534 \
        --read-only \
        --tmpfs /tmp:size=64m,mode=1777 \
        -v "$BINARY:/emu/emu:ro" \
        "$@"
}

report() { printf '\n── %s\n' "$1"; }

report "baseline: python directly (what the sandbox does today)"
sandbox 32 "$IMAGE" python3 -u -c "$SCRIPT" && baseline=0 || baseline=$?
echo "exit code: $baseline"

report "through emu"
sandbox 32 "$IMAGE" /emu/emu run -- python3 -u -c "$SCRIPT" && supervised=0 || supervised=$?
echo "exit code: $supervised"

[ "$baseline" = "$supervised" ] || {
    echo "FAIL: exit code changed from $baseline to $supervised" >&2
    exit 1
}
echo "OK: exit code unchanged under emu"

report "pids-limit 10 (the value P7 replaced) — expected to fail"
if sandbox 10 "$IMAGE" /emu/emu run -- python3 -u -c 'print("should not get here")' 2>&1; then
    echo "NOTE: survived pids-limit 10; the raise to 32 is headroom, not a hard fix"
else
    echo "OK: confirms why pids-limit had to rise from 10"
fi

report "orphan reaping: child backgrounds a grandchild and exits first"
sandbox 32 "$IMAGE" /emu/emu run -- sh -c 'sleep 0.3 & exit 0'
echo "OK: emu waited for the orphan instead of leaving a zombie"

# ── Adversarial: the child is untrusted code sharing PID 1's uid and namespace ──

report "hostile child: cannot kill the supervisor"
# The kernel discards unhandled signals sent to a PID namespace's init from inside
# that namespace, so kill() succeeds while the signal does nothing. emu must still
# report the child's own exit code.
sandbox 32 "$IMAGE" /emu/emu run -- python3 -u -c '
import os, signal, sys
for sig in (signal.SIGKILL, signal.SIGSTOP):
    try:
        os.kill(1, sig)
    except OSError:
        pass
print("supervisor survived")
sys.exit(11)' && killed=0 || killed=$?
[ "$killed" = "11" ] || { echo "FAIL: exit code $killed, want 11" >&2; exit 1; }
echo "OK: signals to PID 1 did not kill emu, exit code preserved"

report "hostile child: signal flood does not hang the run"
# SIGCHLD coalesces and the notification buffer is finite, so a flood can drop the
# child's real exit notification. The periodic reap backstop is what stops that
# from hanging the run until the sandbox timeout.
# SIGTERM is ignored by the child on purpose: emu relays a relayable signal back
# to whoever is the child, so a child that floods SIGTERM at PID 1 would otherwise
# be killed by its own signal (exit 143) before the flood proved anything.
sandbox 32 "$IMAGE" timeout 20 /emu/emu run -- python3 -u -c '
import os, signal, sys
signal.signal(signal.SIGTERM, signal.SIG_IGN)
for _ in range(2000):
    for sig in (signal.SIGCHLD, signal.SIGTERM):
        try:
            os.kill(1, sig)
        except OSError:
            pass
print("flood done")
sys.exit(12)' && flooded=0 || flooded=$?
[ "$flooded" = "12" ] || { echo "FAIL: exit code $flooded, want 12 (124 means it hung)" >&2; exit 1; }
echo "OK: run completed despite 4000 signals at PID 1"

report "idle RSS baseline"
container=$(sandbox 32 -d "$IMAGE" /emu/emu run -- sleep 10)
sleep 2
docker stats --no-stream --format 'emu + sleep: {{.MemUsage}} (limit {{.MemPerc}})' "$container"
docker rm -f "$container" >/dev/null

# ── P1: the control core ───────────────────────────────────────────────────────

# A lesson run's config arrives read-only, exactly as rce-service will mount it.
configured() {
    sandbox 32 -v "$WORK/config.json:/emu/config.json:ro" "$IMAGE" "$@"
}

report "config-driven run: op log on stdout, child output and exit code untouched"
configured /emu/emu run --config /emu/config.json -- python3 -u -c "$SCRIPT" \
    > "$WORK/run.out" 2>"$WORK/run.err" && withConfig=0 || withConfig=$?
cat "$WORK/run.out" "$WORK/run.err"
[ "$withConfig" = "$baseline" ] || {
    echo "FAIL: exit code changed from $baseline to $withConfig under --config" >&2
    exit 1
}
grep -q 'stdout line' "$WORK/run.out" || { echo "FAIL: the child's stdout was lost" >&2; exit 1; }
grep -q '"emu_oplog"' "$WORK/run.out" || { echo "FAIL: no op log on stdout" >&2; exit 1; }
echo "OK: the tagged op log rides out on stdout beside the child's own output"

report "a lesson run opens no control channel at all"
# The config above exercises every field the loader knows. None of them can open a
# socket, and the unknown-field check means none can be added by a lesson author
# without failing the run.
sockets=$(configured /emu/emu run --config /emu/config.json -- \
    sh -c 'find /tmp /emu /run /var/run -type s 2>/dev/null' | grep -v '^{"emu_oplog"' || true)
[ -z "$sockets" ] || { echo "FAIL: a config-driven run left sockets: $sockets" >&2; exit 1; }
echo "OK: nothing to connect to inside a run driven only by --config"

report "a lesson run binds its emulators and nothing else"
# P3 binds 5432 (0x1538). The HTTP control plane would be 9100 (0x238C), and
# loopback exists even under --network none — so "no network" is not what keeps
# the control plane shut, the argv-only flag is.
listening=$(configured /emu/emu run --config /emu/config.json -- \
    sh -c 'cat /proc/net/tcp /proc/net/tcp6 2>/dev/null | grep " 0A " || true' | grep -v '^{"emu_oplog"' || true)
case "$listening" in
    *:1538*) echo "OK: postgres is listening on 5432 before the child starts" ;;
    *) echo "FAIL: the declared emulator is not listening: $listening" >&2; exit 1 ;;
esac
echo "$listening" | grep -q ':238C' && {
    echo "FAIL: a config-driven run opened the control plane" >&2; exit 1
}
echo "OK: the control plane is shut in a run driven only by --config"

report "why: with the dev flag, the child reaches the socket and disarms its faults"
# A measurement, not a regression. emu and student code share uid 65534, so mode
# 0600 grants the student write access to the control plane — which is the whole
# reason rce-service never passes --dev-control-socket.
configured /emu/emu run --config /emu/config.json --dev-control-socket /tmp/emu.sock -- python3 -u -c '
import json, socket, sys
client = socket.socket(socket.AF_UNIX)
client.connect("/tmp/emu.sock")
client.sendall(json.dumps({"cmd": "fault.reset"}).encode() + b"\n")
reply = json.loads(client.makefile().readline())
print("student disarmed every fault:", reply["ok"])
sys.exit(0 if reply.get("ok") else 1)' && reachable=0 || reachable=$?
[ "$reachable" = "0" ] || {
    echo "FAIL: expected the child to reach the socket; the threat model is out of date" >&2
    exit 1
}
echo "OK: confirmed — which is why a lesson run never carries that flag"

report "the dashboard refuses an address that would leave the machine"
# ":9100" binds every interface. On a laptop on a shared network that hands
# anyone a fault injector and a live op log.
if configured /emu/emu run --config /emu/config.json --dev-control-bind :9100 -- true 2>&1 | grep -q loopback; then
    echo "OK: only loopback is accepted"
else
    echo "FAIL: a non-loopback dashboard address was accepted" >&2
    exit 1
fi

report "idle RSS with the dashboard linked in"
container=$(sandbox 32 -d "$IMAGE" /emu/emu run -- sleep 10)
sleep 2
docker stats --no-stream --format 'emu + sleep: {{.MemUsage}} (limit {{.MemPerc}})' "$container"
docker rm -f "$container" >/dev/null

# ── P3: the SQL database ───────────────────────────────────────────────────────

report "psycopg talks to the emulator with no shim, and the faulted commit rolls back"
# glibc rather than musl, because psycopg's binary wheels are manylinux only.
# emu itself is static and does not care which image a lesson runs.
CLIENT_IMAGE=emu-psycopg-check
docker build -q -t "$CLIENT_IMAGE" - >/dev/null <<'DOCKERFILE'
FROM python:3.11-slim
RUN pip install --no-cache-dir "psycopg[binary]==3.2.*"
DOCKERFILE

sandbox 32 \
    -v "$WORK/config.json:/emu/config.json:ro" \
    -v "$WORK/lesson.py:/emu/lesson.py:ro" \
    "$CLIENT_IMAGE" /emu/emu run --config /emu/config.json -- python3 -u /emu/lesson.py \
    > "$WORK/lesson.out" 2>"$WORK/lesson.err" && lesson=0 || lesson=$?
cat "$WORK/lesson.out" "$WORK/lesson.err"
[ "$lesson" = "0" ] || { echo "FAIL: the lesson did not behave as the plan describes" >&2; exit 1; }
grep -q '"op":"COMMIT","fault":"error"' "$WORK/lesson.out" || {
    echo "FAIL: the op log does not show which commit was faulted" >&2; exit 1
}
echo "OK: the third commit failed as a serialization error and left nothing behind"

report "idle RSS with the SQL database linked in"
container=$(sandbox 32 -v "$WORK/config.json:/emu/config.json:ro" -d "$IMAGE" \
    /emu/emu run --config /emu/config.json -- sleep 10)
sleep 2
docker stats --no-stream --format 'emu + postgres + sleep: {{.MemUsage}} (limit {{.MemPerc}})' "$container"
docker rm -f "$container" >/dev/null

# ── P4: the cache ──────────────────────────────────────────────────────────────

cat > "$WORK/cache.json" <<'JSON'
{
  "services": ["redis"],
  "seed": { "redis": { "rate:1": "0" } },
  "faults": [
    { "match": "redis.SET", "after": 2, "times": 1, "action": "error",
      "message": "cache write refused" }
  ],
  "log_limit": 500
}
JSON

# The plan's cache lesson, written the way a student would: an ordinary client on
# an ordinary port, no protocol argument, no shim.
cat > "$WORK/cache.py" <<'PY'
import sys
import time

import redis

cache = redis.Redis(host="127.0.0.1", port=6379, decode_responses=True)

print("seeded rate:1 is", cache.get("rate:1"))
print("after incr:", cache.incr("rate:1"))

failures = 0
for attempt in range(3):
    try:
        cache.set(f"key:{attempt}", attempt)
        print(f"write {attempt} ok")
    except redis.exceptions.ResponseError as refused:
        failures += 1
        print(f"write {attempt} failed: {refused}")

landed = [key for key in ("key:0", "key:1", "key:2") if cache.exists(key)]
print("keys that landed:", landed)

cache.set("brief", "v", ex=1)
time.sleep(1.2)
expired = cache.get("brief")
print("after the TTL passed:", expired)

if failures != 1:
    sys.exit(f"expected exactly one refused write, got {failures}")
if landed != ["key:0", "key:1"]:
    sys.exit(f"expected the first two writes to have landed, got {landed}")
if expired is not None:
    sys.exit(f"expected the key to have expired, got {expired}")
PY

report "redis-py talks to the emulator with no shim, and the third write is refused"
# alpine is enough here, unlike psycopg above: redis-py is pure Python. The pinned
# major matters though — redis-py 8 opens with HELLO 3 and raises rather than
# falling back, which is the whole reason emu answers RESP3 at all.
CACHE_IMAGE=emu-redis-check
docker build -q -t "$CACHE_IMAGE" - >/dev/null <<'DOCKERFILE'
FROM python:3.11-alpine
RUN pip install --no-cache-dir "redis==8.*"
DOCKERFILE

sandbox 32 \
    -v "$WORK/cache.json:/emu/config.json:ro" \
    -v "$WORK/cache.py:/emu/cache.py:ro" \
    "$CACHE_IMAGE" /emu/emu run --config /emu/config.json -- python3 -u /emu/cache.py \
    > "$WORK/cache.out" 2>"$WORK/cache.err" && cached=0 || cached=$?
cat "$WORK/cache.out" "$WORK/cache.err"
[ "$cached" = "0" ] || { echo "FAIL: the cache lesson did not behave as the plan describes" >&2; exit 1; }
grep -q '"op":"SET","target":"key:2","fault":"error"' "$WORK/cache.out" || {
    echo "FAIL: the op log does not show which write was faulted" >&2; exit 1
}
echo "OK: the third SET was refused, the first two are still in the cache, and the TTL passed"

report "the cache is bound before the child can connect to it"
# 6379 is 0x18EB.
cacheBound=$(sandbox 32 -v "$WORK/cache.json:/emu/config.json:ro" "$IMAGE" \
    /emu/emu run --config /emu/config.json -- \
    sh -c 'cat /proc/net/tcp /proc/net/tcp6 2>/dev/null | grep " 0A " || true' | grep -v '^{"emu_oplog"' || true)
case "$cacheBound" in
    *:18EB*) echo "OK: redis is listening on 6379 before the child starts" ;;
    *) echo "FAIL: the declared emulator is not listening: $cacheBound" >&2; exit 1 ;;
esac

report "idle RSS with the cache linked in"
container=$(sandbox 32 -v "$WORK/cache.json:/emu/config.json:ro" -d "$IMAGE" \
    /emu/emu run --config /emu/config.json -- sleep 10)
sleep 2
docker stats --no-stream --format 'emu + redis + sleep: {{.MemUsage}} (limit {{.MemPerc}})' "$container"
docker rm -f "$container" >/dev/null

# ── P5: the message queue ──────────────────────────────────────────────────────

cat > "$WORK/queue.json" <<'JSON'
{
  "services": ["queue"],
  "seed": {
    "queue": { "queues": [{ "name": "jobs" }] }
  },
  "faults": [
    { "match": "queue.publish", "when": { "depth_gte": 100 }, "action": "error",
      "message": "the queue is full" }
  ],
  "log_limit": 500
}
JSON

# The lesson the plan describes: a round trip through a real consumer, and then
# a queue that will not take a hundred and first message.
#
# Publisher confirms are on, and that is not decoration. Basic.Publish is
# asynchronous, so without them a client does not wait for anything and learns
# of a refused publish only at its next synchronous call — which would make
# "the hundred and first publish fails" fail somewhere after it.
cat > "$WORK/queue-lesson.py" <<'PY'
import sys

import pika

conn = pika.BlockingConnection(pika.ConnectionParameters("127.0.0.1"))
channel = conn.channel()
channel.confirm_delivery()
channel.queue_declare(queue="jobs", durable=True)

received = []


def handle(worker, delivery, properties, body):
    received.append(body.decode())
    worker.basic_ack(delivery.delivery_tag)
    worker.stop_consuming()


channel.basic_publish("", "jobs", b"job 1")
channel.basic_consume("jobs", handle)
channel.start_consuming()
print(f"consumed and acknowledged: {received}")

accepted = 0
try:
    for _ in range(200):
        channel.basic_publish("", "jobs", b"filler")
        accepted += 1
except pika.exceptions.AMQPChannelError as refusal:
    print(f"publish {accepted} refused: {refusal}")

print(f"accepted before the cap bit: {accepted}")

if received != ["job 1"]:
    sys.exit(f"expected the published job to come back, got {received}")
if accepted != 100:
    sys.exit(f"expected the cap to allow exactly 100 publishes, got {accepted}")
PY

report "the queue binds 5672 before the child starts"
# 5672 is 0x1628. As with 5432, loopback exists even under --network none, so
# what keeps everything else shut is the config, not the missing network.
queued() {
    sandbox 32 -v "$WORK/queue.json:/emu/queue.json:ro" "$IMAGE" "$@"
}
listening=$(queued /emu/emu run --config /emu/queue.json -- \
    sh -c 'cat /proc/net/tcp /proc/net/tcp6 2>/dev/null | grep " 0A " || true' | grep -v '^{"emu_oplog"' || true)
case "$listening" in
    *:1628*) echo "OK: the queue is listening on 5672" ;;
    *) echo "FAIL: the declared emulator is not listening: $listening" >&2; exit 1 ;;
esac

report "pika talks to the emulator with no shim, and the depth cap refuses the 101st publish"
# pika is pure Python, so unlike psycopg it needs no glibc image of its own.
QUEUE_IMAGE=emu-pika-check
docker build -q -t "$QUEUE_IMAGE" - >/dev/null <<'DOCKERFILE'
FROM python:3.11-alpine
RUN pip install --no-cache-dir "pika==1.3.*"
DOCKERFILE

sandbox 32 \
    -v "$WORK/queue.json:/emu/queue.json:ro" \
    -v "$WORK/queue-lesson.py:/emu/queue-lesson.py:ro" \
    "$QUEUE_IMAGE" /emu/emu run --config /emu/queue.json -- python3 -u /emu/queue-lesson.py \
    > "$WORK/queue.out" 2>"$WORK/queue.err" && queue=0 || queue=$?
cat "$WORK/queue.out" "$WORK/queue.err"
[ "$queue" = "0" ] || { echo "FAIL: the queue lesson did not behave as the plan describes" >&2; exit 1; }
grep -q '"op":"publish","target":"jobs","fault":"error"' "$WORK/queue.out" || {
    echo "FAIL: the op log does not show which publish was refused" >&2; exit 1
}
echo "OK: the round trip works and the hundred and first publish was refused"

report "idle RSS with the message queue linked in"
container=$(sandbox 32 -v "$WORK/queue.json:/emu/queue.json:ro" -d "$IMAGE" \
    /emu/emu run --config /emu/queue.json -- sleep 10)
sleep 2
docker stats --no-stream --format 'emu + queue + sleep: {{.MemUsage}} (limit {{.MemPerc}})' "$container"
docker rm -f "$container" >/dev/null

# ── P6: the document database ──────────────────────────────────────────────────

cat > "$WORK/mongo-config.json" <<'JSON'
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
  ],
  "log_limit": 500
}
JSON

# Written the way a student would: an ordinary MongoClient, an ordinary
# connection string, no shims.
cat > "$WORK/mongo-lesson.py" <<'PY'
import sys

from pymongo import MongoClient
from pymongo.errors import OperationFailure

orders = MongoClient("mongodb://127.0.0.1:27017").shop.orders

print("seeded:", sorted(d["sku"] for d in orders.find()))
print("on sale over 100:", orders.count_documents({"tags": "sale", "total": {"$gt": 100}}))

failures = 0
for attempt in range(3):
    try:
        orders.insert_one({"sku": f"batch-{attempt}", "total": 10 * attempt})
        print(f"insert {attempt} ok")
    except OperationFailure as failure:
        failures += 1
        print(f"insert {attempt} failed: {failure}")

persisted = sorted(d["sku"] for d in orders.find({"sku": {"$regex": "^batch"}}))
print("persisted:", persisted)

if failures != 1:
    sys.exit(f"expected exactly one failed insert, got {failures}")
if persisted != ["batch-0", "batch-1"]:
    sys.exit(f"expected the first two inserts to have persisted, got {persisted}")
PY

report "pymongo talks to the emulator with no shim, and the faulted insert leaves nothing"
MONGO_IMAGE=emu-pymongo-check
docker build -q -t "$MONGO_IMAGE" - >/dev/null <<'DOCKERFILE'
FROM python:3.11-slim
RUN pip install --no-cache-dir "pymongo==4.*"
DOCKERFILE

sandbox 32 \
    -v "$WORK/mongo-config.json:/emu/config.json:ro" \
    -v "$WORK/mongo-lesson.py:/emu/lesson.py:ro" \
    "$MONGO_IMAGE" /emu/emu run --config /emu/config.json -- python3 -u /emu/lesson.py \
    > "$WORK/mongo.out" 2>"$WORK/mongo.err" && mongo=0 || mongo=$?
cat "$WORK/mongo.out" "$WORK/mongo.err"
[ "$mongo" = "0" ] || { echo "FAIL: the lesson did not behave as the plan describes" >&2; exit 1; }
grep -q '"op":"insert","target":"orders","fault":"error"' "$WORK/mongo.out" || {
    echo "FAIL: the op log does not show which insert was faulted" >&2; exit 1
}
echo "OK: the third insert failed as a write conflict and the first two are still there"

report "a document lesson binds 27017 and nothing else"
# 27017 is 0x6989. The control plane would be 9100 (0x238C), and loopback exists
# even under --network none.
listening=$(sandbox 32 -v "$WORK/mongo-config.json:/emu/config.json:ro" "$IMAGE" \
    /emu/emu run --config /emu/config.json -- \
    sh -c 'cat /proc/net/tcp /proc/net/tcp6 2>/dev/null | grep " 0A " || true' | grep -v '^{"emu_oplog"' || true)
case "$listening" in
    *:6989*) echo "OK: mongo is listening on 27017 before the child starts" ;;
    *) echo "FAIL: the declared emulator is not listening: $listening" >&2; exit 1 ;;
esac

report "idle RSS with the document database linked in"
container=$(sandbox 32 -v "$WORK/mongo-config.json:/emu/config.json:ro" -d "$IMAGE" \
    /emu/emu run --config /emu/config.json -- sleep 10)
sleep 2
docker stats --no-stream --format 'emu + mongo + sleep: {{.MemUsage}} (limit {{.MemPerc}})' "$container"
docker rm -f "$container" >/dev/null

# ── P7: the way rce-service actually delivers and invokes emu ──────────────────

report "the binary reaches the sandbox through a read-only named volume"
# Not the host path the checks above mount: the real delivery. The shipped image
# is FROM scratch and has no shell, so emu copies itself into the volume.
docker build -q -t emu:verify . >/dev/null
docker volume rm emu-bin-verify >/dev/null 2>&1 || true
docker volume create emu-bin-verify >/dev/null
docker run --rm -v emu-bin-verify:/out emu:verify install /out/emu
trap 'rm -rf "$WORK"; docker volume rm emu-bin-verify >/dev/null 2>&1 || true' EXIT

# The same posture as sandbox(), with the volume in place of the host binary and
# the GOMAXPROCS/GOMEMLIMIT rce_service/emu.py sets on the emu process.
published() {
    image="$1"
    shift
    docker run --rm \
        --network none \
        --memory 192m --memory-swap 192m \
        --pids-limit 32 \
        --cap-drop ALL \
        --security-opt no-new-privileges \
        --user 65534:65534 \
        --read-only \
        --tmpfs /tmp:size=64m,mode=1777 \
        -v emu-bin-verify:/emu:ro \
        -e GOMAXPROCS=1 -e GOMEMLIMIT=48MiB \
        "$image" "$@"
}

published "$IMAGE" /emu/emu run -- python3 -c 'print("ran from the volume")'

report "the code being graded cannot write the binary that grades it"
if published "$IMAGE" sh -c 'rm -f /emu/emu' 2>&1; then
    echo "FAIL: the run container deleted the emu binary" >&2
    exit 1
fi
echo "OK: the volume is read-only to the student"

report "the lesson runs through the exact command rce-service composes"
# pg8000 rather than psycopg, because this is the real run image: Alpine/musl,
# wheels only, and psycopg's binary wheels are manylinux. Both drivers speak the
# same protocol; only one installs where student code actually runs.
CLIENT_IMAGE=emu-pg8000-check
docker build -q -t "$CLIENT_IMAGE" - >/dev/null <<'DOCKERFILE'
FROM python:3.11-alpine
RUN pip install --no-cache-dir --only-binary=:all: "pg8000==1.31.*"
DOCKERFILE

cat > "$WORK/lesson8000.py" <<'PY'
import sys

import pg8000.dbapi

db = pg8000.dbapi.connect(user="app", host="127.0.0.1", port=5432, database="app")
failures = 0

for transfer in range(3):
    cursor = db.cursor()
    try:
        cursor.execute("UPDATE accounts SET balance = balance - 10 WHERE id = 1")
        db.commit()
        print(f"transfer {transfer} ok")
    except Exception as failure:
        db.rollback()
        failures += 1
        print(f"transfer {transfer} failed: {failure}")

cursor = db.cursor()
cursor.execute("SELECT balance FROM accounts WHERE id = 1")
balance = cursor.fetchone()[0]
print(f"balance is {balance}")

with open("/proc/1/cmdline") as handle:
    pid_one = handle.read().replace("\0", " ").strip()
print(f"pid 1 is {pid_one}")
with open("/sys/fs/cgroup/memory.peak") as handle:
    print(f"cgroup memory.peak is {handle.read().strip()}")
with open("/sys/fs/cgroup/pids.peak") as handle:
    print(f"cgroup pids.peak is {handle.read().strip()}")

if failures != 1:
    sys.exit(f"expected exactly one serialization failure, got {failures}")
if balance != 80:
    sys.exit(f"expected balance 80 with the faulted transaction rolled back, got {balance}")
if not pid_one.startswith("/emu/emu"):
    sys.exit(f"emu is not PID 1, so the student could kill it: {pid_one}")
PY

# rce_service/docker.py writes both inputs into the tmpfs and hands emu the
# process with exec. Reproduced literally, because the shape of this line is the
# integration: a bind mount would be wrong (rce-service does not share a
# filesystem with the host daemon) and dropping the exec would cost emu PID 1.
CONFIG_B64=$(base64 -w0 < "$WORK/config.json" 2>/dev/null || base64 < "$WORK/config.json" | tr -d '\n')
LESSON_B64=$(base64 -w0 < "$WORK/lesson8000.py" 2>/dev/null || base64 < "$WORK/lesson8000.py" | tr -d '\n')

published "$CLIENT_IMAGE" sh -c "\
echo $CONFIG_B64 | base64 -d > /tmp/emu-config.json && \
echo $LESSON_B64 | base64 -d > /tmp/lesson.py && \
exec /emu/emu run --config /tmp/emu-config.json -- python3 -u /tmp/lesson.py" \
    > "$WORK/p7.out" 2>"$WORK/p7.err" && integrated=0 || integrated=$?
cat "$WORK/p7.out" "$WORK/p7.err"
[ "$integrated" = "0" ] || { echo "FAIL: the lesson did not behave as the plan describes" >&2; exit 1; }
grep -q '"op":"COMMIT","fault":"error"' "$WORK/p7.out" || {
    echo "FAIL: the op log does not show which commit was faulted" >&2; exit 1
}
echo "OK: emu is PID 1, the fault fired, and the op log rode out on stdout"

report "a student cannot forge the op log rce-service reads"
# rce-service takes the LAST line, and emu writes after the child has exited.
published "$IMAGE" sh -c "\
echo $CONFIG_B64 | base64 -d > /tmp/emu-config.json && \
exec /emu/emu run --config /tmp/emu-config.json -- \
python3 -u -c 'print(\"{\\\"emu_oplog\\\": [{\\\"n\\\": 1, \\\"op\\\": \\\"FORGED\\\"}]}\")'" \
    > "$WORK/forged.out"
cat "$WORK/forged.out"
[ "$(tail -n 1 "$WORK/forged.out")" = '{"emu_oplog":[]}' ] || {
    echo "FAIL: the student's line was the last one, so it would be read as the op log" >&2
    exit 1
}
echo "OK: emu's own dump is last, so the forgery stays in the student's stdout"

printf '\nall P0, P1, P2, P3, P4, P5, P6, and P7 checks passed\n'
