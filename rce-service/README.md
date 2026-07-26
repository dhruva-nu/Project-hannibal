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

## Infra lessons (Phase 0b, #133)

A job may declare `infra` — emulators from [`cannae-service`](../cannae-service/README.md)
the lesson runs against. That run gets its own two-network topology, built for the
run and destroyed with it:

```
  student container ──[ cannae-sbx-<run> : internal ]── cannae container
                                                              │
  rce-service (harness) ─[ cannae-ctl-<run> : internal ]──────┘
                                                    static IP, :9900
```

Both networks are `internal`, so the only thing student code can reach is the
emulator's data ports — by ordinary hostname, through ordinary connection strings
(`ECHO_URL`, `DATABASE_URL`, `REDIS_URL`, …). The control plane is bound to the
**harness** address only (`--control-bind`), so `:9900` is not listening on any
interface the student can route to: students cannot reset or inspect their own
graded state.

A job with no `infra` — everything the backend sends today — keeps
`network_mode="none"` unchanged.

See `rce_service/infra.py` and
`hannibal-vault/features/code-execution.md` § *Infra lessons*.

## Tests

```
uv run pytest                                        # unit suite, 100% coverage gate

RCE_SMOKE=1 uv run pytest tests/integration/test_rce_deps_smoke.py
# real Docker + network: cold install → cached offline run

docker build -t cannae-service:latest ../cannae-service
RCE_INFRA_SMOKE=1 uv run pytest tests/integration/test_infra_isolation.py
# real Docker: probes the sandbox isolation from inside a student container
```
