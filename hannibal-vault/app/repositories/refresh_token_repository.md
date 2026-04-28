---
name: refresh_token_repository.py
description: Database operations for refresh tokens — create, lookup by jti, and revoke
type: file
layer: data
tags: [repository, refresh-token, sqlalchemy]
imports:
  - "[[app/models/refresh_token]]"
---

# `app/repositories/refresh_token_repository.py`

Manages the `refresh_tokens` table. The `jti` (JWT ID) is the stable identifier — it's stored in the token itself and in the DB row to allow precise revocation without touching the token value.

**Imports:** [[app/models/refresh_token]]

---

## `create` — lines 12–17

Inserts a new `RefreshToken` row with the given `user_id`, `jti`, and `expires_at`. Called after every successful login or OAuth sign-in.

---

## `get_by_jti` — lines 19–20

Looks up a refresh token row by its `jti` UUID. Returns `RefreshToken | None`. Used by [[app/services/auth_service#refresh]] to validate before issuing a new access token.

---

## `revoke_by_jti` — lines 22–26

Sets `revoked = True` on the token row identified by `jti` and commits. Called during logout. Subsequent `refresh` attempts will see `record.revoked = True` and reject.

**Calls:** `get_by_jti`
