# rce-service

The sandboxed remote-code-execution worker for Project Hannibal.

It consumes execution jobs from RabbitMQ (`rce.jobs`), runs untrusted student
code in locked-down throwaway Docker containers on the host daemon, resolves and
installs allowlisted dependencies into per-language cache volumes, and returns
results (sync RPC reply) or streams stdout events (topic exchange `rce.events`).

The main FastAPI backend keeps its HTTP endpoints and talks to this service over
the broker, so the frontend is unaffected. See
`hannibal-vault/features/code-execution.md` for the full architecture.

## Run

```
uv run python -m rce_service.main        # start the worker
uv run python -m rce_service.prewarm     # seed the package caches from allowlists
uv run pytest                            # tests
```

Requires `RABBITMQ_URL` and access to the Docker daemon socket.

## Infrastructure emulators (`emu`)

A job may carry an `emu` config — the services a lesson wants on loopback, their
seed data, and the faults to arm. When it does, `emu` takes the container's
command slot and the student's interpreter becomes its child:

```
sh -c 'echo <config> | base64 -d > /tmp/emu-config.json &&
       echo <code>   | base64 -d > /tmp/<id>.py &&
       exec /emu/emu run --config /tmp/emu-config.json -- python3 /tmp/<id>.py'
```

The result then carries `emu_oplog`: every operation the student's code performed
against the emulators, and which of them were faulted. That is what lets a lesson
grade *behaviour* ("did they retry the failed commit?") rather than stdout.

A job **without** an `emu` config runs exactly as it did before emu existed — no
binary mounted, no wrapper, no environment change. `rce_service/emu.py` is the
only module that knows about any of this.

Four things worth knowing before changing it:

- **The binary arrives in the read-only `emu-bin` volume**, the same posture the
  package caches get. Populate it with `just publish-emu`, or `docker compose up`,
  which runs the `emu-publisher` service. The worker never builds it — a missing
  volume fails the run loudly rather than confusing a student with `exec: no such
  file`.
- **The config is written into the tmpfs, not bind-mounted.** This service drives
  the *host* Docker daemon from inside its own container, so a path it can write
  is not a path that daemon could mount. emu reads the file before the child
  exists, so a student-writable tmpfs is safe.
- **`exec` is load-bearing.** Without it emu is a child of the shell rather than
  PID 1, and student code sharing uid 65534 could kill the process injecting the
  faults grading it.
- **`--dev-control-socket` / `--dev-control-bind` are never passed.** A lesson run
  has no control channel at all; see the threat model in `plans/emu-service.md`.
  `tests/test_rce_security_invariants.py` is what keeps it that way.

The Postgres driver on the allowlist is `pg8000`, not `psycopg`: the run image is
Alpine/musl and the installer takes wheels only, while psycopg's binary wheels are
manylinux. Same wire protocol, and it installs where student code runs.

Sandbox limits are sized for this — 32 pids, 192 MB, 30 s (`config.py`) — and are
measured rather than guessed; `emu-service/verify-sandbox.sh` is where the numbers
come from.
