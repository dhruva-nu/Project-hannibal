# HealthRepository

**File:** `backend/app/repositories/health_repository.py`

No DB query — returns a hardcoded `HealthPayload(status="ok", service="backend")`. Exists to keep the layer contract consistent.

## Methods

| Method | Lines | Notes |
|--------|-------|-------|
| `get` | 5–6 | Returns in-memory payload, no DB hit |

## Called by

← [[HealthService]]
