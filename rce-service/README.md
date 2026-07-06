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
