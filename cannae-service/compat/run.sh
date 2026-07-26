#!/usr/bin/env bash
# Run the blessed-client compatibility matrix against a freshly booted emulator.
#
# The matrix is the contract: a lesson may only hand a student a client library that
# is proved here. Adding a language to a lesson means adding a script here first
# (`plans/infra-emulators.md` §3 for the cache, §4 for SQL).
#
#   ./compat/run.sh                     # build, boot, run every client
#   CANNAE_PORT=6380 ./compat/run.sh    # if something already owns that port
set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${CANNAE_PORT:-16379}"
SQL_PORT="${CANNAE_SQL_PORT:-15432}"
CONTROL_PORT="${CANNAE_CONTROL_PORT:-19900}"
export CANNAE_PORT="${PORT}"
export CANNAE_SQL_PORT="${SQL_PORT}"
export CANNAE_HOST="${CANNAE_HOST:-127.0.0.1}"
export CANNAE_CONTROL="http://127.0.0.1:${CONTROL_PORT}"

echo "==> building cannae"
cargo build -p cannae

echo "==> booting cache on :${PORT} and sql on :${SQL_PORT}, control on :${CONTROL_PORT}"
# One process serves both, which is exactly how a lesson declaring
# `infra: [redis, postgres]` runs them — so the matrix exercises that shape too.
./target/debug/cannae \
  --infra "cache:${PORT},sql:${SQL_PORT}" \
  --control-bind "127.0.0.1:${CONTROL_PORT}" &
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
echo "==> psycopg2"
uv run --quiet --with 'psycopg2-binary>=2.9,<3' compat/banking.py

echo
echo "==> SQLAlchemy (on psycopg2)"
uv run --quiet --with 'SQLAlchemy>=2,<3' --with 'psycopg2-binary>=2.9,<3' \
  compat/banking_sqlalchemy.py

# `npm ci` — the whole point of this matrix is the client version it proves, so the
# lockfile decides it, not whatever `install` resolves on the day.
echo
echo "==> installing the Node clients"
(cd compat && npm ci --silent --no-fund --no-audit)

echo
echo "==> ioredis"
(cd compat && node cache_aside.mjs)

echo
echo "==> node-postgres"
(cd compat && node banking.mjs)

echo
echo "compat matrix passed: redis-py, ioredis, psycopg2, SQLAlchemy, node-postgres"
