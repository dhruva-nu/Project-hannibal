---
name: health.py (schemas)
description: Pydantic models for the health endpoint — HealthPayload and HealthResponse
type: file
layer: api
tags: [schema, pydantic, health]
---

# `app/schemas/health.py`

Two Pydantic models for the health endpoint.

**Used by:** [[app/api/v1/controllers/health_controller]] · [[app/services/health_service]] · [[app/repositories/health_repository]]

---

### `HealthPayload`
Base model: `status` (str), `service` (str).

### `HealthResponse`
Extends `HealthPayload` with no additional fields — exists so the response type has a distinct name from the internal payload, keeping the API contract decoupled from the internal representation.
