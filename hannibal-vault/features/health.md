# Health Feature

← [[00 - Features Index|Back to index]]

Infrastructure liveness probe. No FE page. No DB query — the repository returns a hardcoded payload.

## Data flow

```
(load balancer / Docker healthcheck) ──► [[health-controller]] ──► [[HealthService]] ──► [[HealthRepository]]
```

## Nodes in this feature

### Backend
- [[health-controller]] — `GET /api/v1/health`
- [[HealthService]] — thin delegate
- [[HealthRepository]] — returns hardcoded `{ status: "ok", service: "backend" }`
