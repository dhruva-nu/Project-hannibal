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

## `auth_copilotkit` (middleware) — lines 29–39

Guards every `POST /copilotkit` request. Extracts the `access_token` cookie and validates it with `jwt.decode`. Returns `401` if missing or invalid before the request reaches the route handler.

**Calls:** [[app/core/config#settings]]

---

## `capture_copilotkit_context` (middleware) — lines 41–52

Reads the raw POST body for every CopilotKit request, parses the `context` array that CopilotKit sends from `useCopilotReadable`, and stores it in the `active_ck_context` ContextVar exported from [[app/api/v1/controllers/copilotkit_controller]]. This is the only reliable way to forward readable context to the ADK agent — the CopilotKit SDK does not pass `context` through `Agent.execute` consistently across versions.

**Calls:** [[app/api/v1/controllers/copilotkit_controller#active_ck_context]]

---

## `run` — lines 80–86

Entry point when the module is run directly (`python main.py`). Starts Uvicorn with settings from [[app/core/config#settings]].

**Calls:** [[app/core/config#settings]]
