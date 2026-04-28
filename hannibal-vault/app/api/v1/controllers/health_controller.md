---
name: health_controller.py
description: Single GET /health endpoint — liveness probe that returns service status
type: file
layer: api
tags: [controller, health]
imports:
  - "[[app/dependencies/health]]"
  - "[[app/schemas/health]]"
  - "[[app/services/health_service]]"
---

# `app/api/v1/controllers/health_controller.py`

Single-route controller for `/api/v1/health`.

**Imports:** [[app/dependencies/health]] · [[app/schemas/health]] · [[app/services/health_service]]

---

## `get_health` — lines 10–14

`GET /health`

Delegates entirely to [[app/services/health_service#get_health_status]] and returns the result as a `HealthResponse`. Used as a Docker/load-balancer liveness probe.

**Calls:** [[app/services/health_service#get_health_status]]
