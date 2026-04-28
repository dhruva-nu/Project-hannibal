---
name: auth.py (dependencies)
description: DI providers for the auth layer — get_db session, get_auth_service factory, require_auth guard
type: file
layer: api
tags: [dependencies, auth, fastapi, di]
imports:
  - "[[app/db/session]]"
  - "[[app/repositories/refresh_token_repository]]"
  - "[[app/repositories/user_repository]]"
  - "[[app/services/auth_service]]"
---

# `app/dependencies/auth.py`

Three FastAPI dependency functions used across the auth controller and middleware.

**Imports:** [[app/db/session]] · [[app/repositories/user_repository]] · [[app/repositories/refresh_token_repository]] · [[app/services/auth_service]]

---

## `get_db` — lines 10–15

Generator dependency. Opens a `SessionLocal` DB session, yields it to the route handler, and always closes it in the `finally` block — ensuring sessions are not leaked even on exceptions.

**Calls:** [[app/db/session#SessionLocal]]

---

## `get_auth_service` — lines 18–22

Constructs and returns an `AuthService` with `UserRepository` and `RefreshTokenRepository` both sharing the same `db` session from `get_db`. Used by every auth controller route via `Depends(get_auth_service)`.

**Calls:** [[app/services/auth_service]] · [[app/repositories/user_repository]] · [[app/repositories/refresh_token_repository]]

---

## `require_auth` — lines 25–35

Auth guard dependency. Reads the `access_token` cookie from the request and calls [[app/services/auth_service#verify_token]]. Raises `401` if missing or invalid. Can be added as a `Depends` to any route that requires a logged-in user.

**Calls:** [[app/services/auth_service#verify_token]]
