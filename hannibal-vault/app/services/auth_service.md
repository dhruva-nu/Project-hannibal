---
name: auth_service.py
description: All authentication business logic — register, login, logout, token refresh, JWT creation, Google OAuth
type: file
layer: business
tags: [service, auth, jwt, bcrypt, oauth]
imports:
  - "[[app/core/config]]"
  - "[[app/repositories/refresh_token_repository]]"
  - "[[app/repositories/user_repository]]"
  - "[[app/schemas/auth]]"
---

# `app/services/auth_service.py`

The heart of the auth system. `AuthService` is instantiated per-request via [[app/dependencies/auth#get_auth_service]] and holds references to both repositories.

**Imports:** [[app/core/config]] · [[app/repositories/user_repository]] · [[app/repositories/refresh_token_repository]] · [[app/schemas/auth]]

---

## `register` — lines 26–31

Creates a new local user. Checks for duplicate email via [[app/repositories/user_repository#get_by_email]], hashes the password with `bcrypt`, then persists via [[app/repositories/user_repository#create]].

**Calls:** [[app/repositories/user_repository#get_by_email]] · [[app/repositories/user_repository#create]]

---

## `login` — lines 33–46

Validates email/password credentials (bcrypt compare). On success, creates an access token and a refresh token, stores the refresh token in the DB via [[app/repositories/refresh_token_repository#create]], and returns both tokens plus the `UserResponse`.

**Calls:** [[app/repositories/user_repository#get_by_email]] · [[app/repositories/refresh_token_repository#create]] · `_create_access_token` · `_create_refresh_token`

---

## `refresh` — lines 48–64

Validates a refresh token JWT, looks up its `jti` in the DB via [[app/repositories/refresh_token_repository#get_by_jti]], checks it hasn't been revoked or expired, then issues a new access token.

**Calls:** [[app/repositories/refresh_token_repository#get_by_jti]] · `_create_access_token`

---

## `logout` — lines 66–73

Decodes the refresh token to extract the `jti`, then revokes it in the DB via [[app/repositories/refresh_token_repository#revoke_by_jti]]. Silently ignores invalid tokens — cookie clearing happens in the controller regardless.

**Calls:** [[app/repositories/refresh_token_repository#revoke_by_jti]]

---

## `verify_token` — lines 75–79

Decodes and validates a JWT (used by `require_auth` in [[app/dependencies/auth]]). Raises `ValueError` on any decode failure.

---

## `generate_oauth_state` — lines 81–85

Creates a CSRF state token for the Google OAuth flow: a random 32-byte URL-safe token concatenated with its HMAC-SHA256 signature over `settings.secret_key`. The combined `token.sig` string is stored as an HttpOnly cookie.

---

## `verify_oauth_state` — lines 87–93

Validates the state returned by Google against the stored cookie. Recomputes the HMAC and uses `hmac.compare_digest` (constant-time) to prevent timing attacks.

---

## `get_google_auth_url` — lines 95–105

Builds the full Google OAuth authorization URL with scopes `openid email profile`, `access_type=offline`, and the provided `state`.

---

## `handle_google_callback` — lines 107–145

Exchanges the OAuth `code` for a Google access token (via `_GOOGLE_TOKEN_URL`), fetches the user's email and ID from `_GOOGLE_USERINFO_URL`, then upserts the user via [[app/repositories/user_repository#get_or_create_oauth_user]]. Issues and stores app tokens the same way as regular login.

**Calls:** [[app/repositories/user_repository#get_or_create_oauth_user]] · [[app/repositories/refresh_token_repository#create]] · `_create_access_token` · `_create_refresh_token`

---

## `_create_access_token` — lines 147–150

Encodes a JWT with the given claims plus an `exp` of `ACCESS_TOKEN_EXPIRE_MINUTES`. Short-lived token used for request authentication.

---

## `_create_refresh_token` — lines 152–161

Encodes a JWT with a unique `jti` UUID and an `exp` of `REFRESH_TOKEN_EXPIRE_DAYS`. The `jti` is what gets stored and revoked in the DB.
