---
name: health.py (dependencies)
description: DI provider for HealthService — constructs HealthRepository and HealthService
type: file
layer: api
tags: [dependencies, health, fastapi, di]
imports:
  - "[[app/repositories/health_repository]]"
  - "[[app/services/health_service]]"
---

# `app/dependencies/health.py`

Single dependency provider for the health endpoint.

**Imports:** [[app/repositories/health_repository]] · [[app/services/health_service]]

---

## `get_health_service` — lines 5–7

Constructs `HealthRepository` and wraps it in `HealthService`. No DB session needed since `HealthRepository` is a no-DB stub. Used by [[app/api/v1/controllers/health_controller]] via `Depends(get_health_service)`.

**Calls:** [[app/repositories/health_repository]] · [[app/services/health_service]]
