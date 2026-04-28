---
name: main.py
description: FastAPI app factory — creates the app, adds middleware, mounts routers and CopilotKit endpoint
type: file
layer: entry
tags: [fastapi, middleware, entry-point]
imports:
  - "[[app/api/router]]"
  - "[[app/api/v1/controllers/copilotkit_controller]]"
  - "[[app/core/config]]"
  - "[[app/core/logging]]"
---

# `app/main.py`

Builds the single `FastAPI` application instance. This is the file Uvicorn imports (`app.main:app`).

**Imports:** [[app/api/router]] · [[app/api/v1/controllers/copilotkit_controller]] · [[app/core/config]] · [[app/core/logging]]

---

## `create_app` — lines 17–77

Constructs and returns the `FastAPI` instance. Responsibilities:
1. Calls [[app/core/logging#configure_logging]] to set up log format
2. Attaches two HTTP middlewares (see below)
3. Adds CORS middleware, allowing only `settings.frontend_origin`
4. Mounts `api_router` (all `/api/v1/...` routes) from [[app/api/router]]
5. Registers the CopilotKit `/info` routes from [[app/api/v1/controllers/copilotkit_controller]]
6. Patches the CopilotKit SDK endpoint to handle the no-trailing-slash POST from the JS SDK

**Calls:** [[app/core/logging#configure_logging]] · [[app/api/router]] · [[app/api/v1/controllers/copilotkit_controller]]

---

## `auth_copilotkit` (middleware) — lines 30–40

Guards every `POST /copilotkit` request. Extracts the `access_token` cookie and validates it with `jwt.decode`. Returns `401` if missing or invalid before the request reaches the route handler.

**Calls:** [[app/core/config#settings]]

---

## `run` — lines 83–89

Entry point when the module is run directly (`python main.py`). Starts Uvicorn with settings from [[app/core/config#settings]].

**Calls:** [[app/core/config#settings]]
