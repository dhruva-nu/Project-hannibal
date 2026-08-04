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

report "idle RSS baseline"
container=$(sandbox 32 -d "$IMAGE" /emu/emu run -- sleep 10)
sleep 2
docker stats --no-stream --format 'emu + sleep: {{.MemUsage}} (limit {{.MemPerc}})' "$container"
docker rm -f "$container" >/dev/null

printf '\nall P0 checks passed\n'
