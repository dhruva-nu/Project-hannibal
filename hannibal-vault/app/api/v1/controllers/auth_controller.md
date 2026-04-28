---
name: auth_controller.py
description: HTTP handlers for all auth endpoints — register, login, logout, refresh, Google OAuth
type: file
layer: api
tags: [controller, auth, oauth, jwt, cookies]
imports:
  - "[[app/core/config]]"
  - "[[app/dependencies/auth]]"
  - "[[app/schemas/auth]]"
  - "[[app/services/auth_service]]"
---

# `app/api/v1/controllers/auth_controller.py`

Owns all routes under `/api/v1/auth/`. Auth tokens are stored exclusively as **HttpOnly cookies** — never in response bodies or `Authorization` headers.

**Imports:** [[app/core/config]] · [[app/dependencies/auth]] · [[app/schemas/auth]] · [[app/services/auth_service]]

---

## `register` — lines 44–57

`POST /auth/register`

Validates password length (≥ 8 chars), then delegates to [[app/services/auth_service#register]]. Returns `201 UserResponse`. Raises `409` if email already exists.

**Calls:** [[app/services/auth_service#register]]

---

## `login` — lines 60–74

`POST /auth/login`

Delegates credential checking to [[app/services/auth_service#login]], then sets `access_token` + `refresh_token` HttpOnly cookies on the response. Returns `UserResponse`.

**Calls:** [[app/services/auth_service#login]]

---

## `logout` — lines 77–90

`POST /auth/logout`

Reads the `refresh_token` cookie and calls [[app/services/auth_service#logout]] to revoke it in the DB. Always clears both auth cookies regardless of whether revocation succeeded.

**Calls:** [[app/services/auth_service#logout]]

---

## `refresh` — lines 93–107

`POST /auth/refresh`

Reads the `refresh_token` cookie, calls [[app/services/auth_service#refresh]] to validate and rotate the access token, then writes a new `access_token` cookie.

**Calls:** [[app/services/auth_service#refresh]]

---

## `google_login` — lines 110–118

`GET /auth/google`

Generates an OAuth CSRF state via [[app/services/auth_service#generate_oauth_state]], stores it as an HttpOnly cookie, and redirects the browser to Google's auth URL from [[app/services/auth_service#get_google_auth_url]].

**Calls:** [[app/services/auth_service#generate_oauth_state]] · [[app/services/auth_service#get_google_auth_url]]

---

## `google_callback` — lines 121–145

`GET /auth/google/callback`

Handles the OAuth redirect from Google. Validates the `state` cookie against the returned `state` param using [[app/services/auth_service#verify_oauth_state]], then calls [[app/services/auth_service#handle_google_callback]] to exchange the code for tokens. Sets auth cookies and redirects to `/home`. Returns error redirects for any failure case.

**Calls:** [[app/services/auth_service#verify_oauth_state]] · [[app/services/auth_service#handle_google_callback]]
