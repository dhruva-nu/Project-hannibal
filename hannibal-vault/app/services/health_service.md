---
name: health_service.py
description: Thin service that assembles the health status response from the health repository
type: file
layer: business
tags: [service, health]
imports:
  - "[[app/repositories/health_repository]]"
  - "[[app/schemas/health]]"
---

# `app/services/health_service.py`

Minimal service — exists to keep the controller/service/repository pattern consistent even for simple endpoints.

**Imports:** [[app/repositories/health_repository]] · [[app/schemas/health]]

---

## `get_health_status` — lines 9–11

Calls [[app/repositories/health_repository#get]] and validates the result into a `HealthResponse` Pydantic model.

**Calls:** [[app/repositories/health_repository#get]]
