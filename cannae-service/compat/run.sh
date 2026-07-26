#!/usr/bin/env bash
# Run the blessed-client compatibility matrix against a freshly booted emulator.
#
# The matrix is the contract: a lesson may only hand a student a client library that
# is proved here. Adding a language to a caching lesson means adding a script here
# first (`plans/infra-emulators.md` §3).
#
#   ./compat/run.sh              # build, boot, run every client
#   CANNAE_PORT=6380 ./run.sh    # if something already owns the standard port
set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${CANNAE_PORT:-16379}"
CONTROL_PORT="${CANNAE_CONTROL_PORT:-19900}"
export CANNAE_PORT="${PORT}"
export CANNAE_HOST="${CANNAE_HOST:-127.0.0.1}"
export CANNAE_CONTROL="http://127.0.0.1:${CONTROL_PORT}"

echo "==> building cannae"
cargo build -p cannae

echo "==> booting cache on :${PORT}, control on :${CONTROL_PORT}"
./target/debug/cannae --infra "cache:${PORT}" --control-bind "127.0.0.1:${CONTROL_PORT}" &
EMULATOR_PID=$!
trap 'kill "${EMULATOR_PID}" 2>/dev/null || true' EXIT

for _ in $(seq 1 100); do
  if curl -sf "${CANNAE_CONTROL}/log?emulator=cache" >/dev/null; then break; fi
  sleep 0.1
done
curl -sf "${CANNAE_CONTROL}/log?emulator=cache" >/dev/null \
  || { echo "control plane never came up"; exit 1; }

echo
echo "==> redis-py"
uv run --quiet --with 'redis>=5,<7' compat/cache_aside.py

echo
echo "==> ioredis"
(cd compat && npm install --silent --no-fund --no-audit && node cache_aside.mjs)

echo
echo "compat matrix passed: redis-py, ioredis"
