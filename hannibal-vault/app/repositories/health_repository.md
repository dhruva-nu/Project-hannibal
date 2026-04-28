---
name: health_repository.py
description: Stub health repository — returns a hardcoded ok payload, no DB involved
type: file
layer: data
tags: [repository, health]
imports:
  - "[[app/schemas/health]]"
---

# `app/repositories/health_repository.py`

A no-op repository that returns a static `HealthPayload`. Exists to keep the controller → service → repository pattern intact for the health endpoint.

**Imports:** [[app/schemas/health]]

---

## `get` — lines 5–6

Returns `HealthPayload(status="ok", service="backend")`. No DB call — the health check is currently a pure liveness probe with no DB dependency check.
