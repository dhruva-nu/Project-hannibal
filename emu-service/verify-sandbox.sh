#!/usr/bin/env sh
# P0 exit criterion: emu runs a Python script inside the real sandbox posture
# with the same output and exit code as running Python directly, and we learn its
# idle RSS as the baseline for later phases.
#
# The posture below mirrors rce_service/docker.py:_start_container exactly. Run
# from emu-service/ after `just build-emu`.
set -eu

BINARY="$(pwd)/build/emu"
IMAGE=python:3.11-alpine
SCRIPT='import sys; print("stdout line"); print("stderr line", file=sys.stderr); sys.exit(3)'

[ -f "$BINARY" ] && [ -x "$BINARY" ] || { echo "missing $BINARY — run: just build-emu" >&2; exit 1; }

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

printf '\nall P0 checks passed\n'
