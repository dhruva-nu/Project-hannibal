# Health

A single liveness endpoint. Used by Docker / load balancers to know the process is up. **It does not check the database or Mongo today** — it returns a hardcoded payload.

## Endpoint

```
GET /api/v1/health/
→ 200  { "status": "ok", "service": "backend" }
→ 503  on any uncaught exception inside the controller
```

## Backend

| File | Lines | Role |
|---|---|---|
| `backend/app/api/v1/controllers/health_controller.py` | 13-26 | Single GET route. Wraps service call in try/except → 503 on failure. |
| `backend/app/services/health_service.py` | 5-11 | One method: `get_health_status()` delegates to repo, returns `HealthResponse`. |
| `backend/app/repositories/health_repository.py` | 5-6 | **Hardcoded** return: `HealthPayload(status="ok", service="backend")`. No DB ping, no Mongo ping. |
| `backend/app/schemas/health.py` | 4-12 | `HealthPayload{status, service}`, `HealthResponse` extends it. |
| `backend/app/dependencies/health.py` | 6-7 | `get_health_service()` → `HealthService(HealthRepository())`. |

## Surprises

- **It is a liveness probe, not a readiness probe.** A response of `200 ok` here proves only that the FastAPI process is alive. The database could be down and you'd still get 200.
- If you need a readiness probe, extend `HealthRepository` to issue `SELECT 1` against the Postgres session and a `ping` against the Mongo client, and return a degraded status if either fails.
