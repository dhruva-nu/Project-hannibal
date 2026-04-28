---
name: router.py
description: Top-level API router — mounts auth and health sub-routers under /api/v1
type: file
layer: api
tags: [router, fastapi]
imports:
  - "[[app/api/v1/controllers/auth_controller]]"
  - "[[app/api/v1/controllers/health_controller]]"
---

# `app/api/router.py`

Creates `api_router` and includes:
- `health_router` at `/health`
- `auth_router` at `/auth`

This router is then mounted in [[app/main]] with the prefix `/api/v1`.

**Imports:** [[app/api/v1/controllers/auth_controller]] · [[app/api/v1/controllers/health_controller]]
