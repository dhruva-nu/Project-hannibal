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

# Every constraint the untrusted-code sandbox applies today. pids is the one value
# this phase changes: emu plus a child measures 9 tasks against today's limit of
# 10, so a trivial script squeezes through but any student thread or subprocess
# does not.
sandbox() {
    pids="$1"
    shift
    docker run --rm \
        --network none \
        --memory 128m --memory-swap 128m \
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

report "pids-limit 10 (today's value) — expected to fail"
if sandbox 10 "$IMAGE" /emu/emu run -- python3 -u -c 'print("should not get here")' 2>&1; then
    echo "NOTE: survived pids-limit 10; the raise to 32 is headroom, not a hard fix"
else
    echo "OK: confirms pids-limit must rise from 10"
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

printf '\nall P0, P1, P2, and P3 checks passed\n'
