---
name: rce_controller.py
description: HTTP handler for POST /rce/execute — validates language, delegates to rce_service, maps errors to status codes
type: file
layer: api
tags: [controller, rce, docker, sandbox]
imports:
  - "[[app/dependencies/auth]]"
  - "[[app/schemas/rce]]"
  - "[[app/services/rce_service]]"
---

# `app/api/v1/controllers/rce_controller.py`

Owns all routes under `/api/v1/rce/`. Thin layer: validates the requested language against `SUPPORTED_LANGUAGES`, delegates execution to [[app/services/rce_service]], and maps service errors to HTTP status codes.

**Imports:** [[app/dependencies/auth]] · [[app/schemas/rce]] · [[app/services/rce_service]]

---

## `execute_code` — lines 15–34

`POST /rce/execute` — requires auth (`require_auth` dependency).

1. Lowercases `request.language` and checks against `SUPPORTED_LANGUAGES` (derived from `rce_service.RUNTIME.keys()`). Returns `400` if unsupported.
2. Calls [[app/services/rce_service#run_code]].
3. Maps `ValueError` (capacity exceeded) → `429`.
4. Maps any other exception → `500` (logs at ERROR with traceback).
5. Returns `ExecuteResponse` on success (`200`).

**Calls:** [[app/services/rce_service#run_code]]
