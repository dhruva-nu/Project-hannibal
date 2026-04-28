---
name: api.ts
description: Fetch wrapper — sends requests with cookies, auto-retries after token refresh on 401
type: file
layer: data
tags: [service, api, fetch, auth, refresh]
---

# `src/services/api.ts`

Thin wrapper around `fetch`. Always includes `credentials: "include"` so auth cookies are sent. Handles the token refresh cycle transparently.

**Used by:** [[frontend/src/context/AuthContext]] · [[frontend/src/pages/Login/Login]]

---

## `apiFetch` — lines 10–46

Core fetch function. Steps:
1. Builds a `RequestInit` with `credentials: "include"` and JSON body if provided
2. Makes the initial request
3. If the response is `401` and the path is not in `SKIP_REFRESH` (login/refresh/register endpoints), attempts `POST /api/v1/auth/refresh`
4. If refresh fails → redirects to `/login`
5. If refresh succeeds → retries the original request once
6. On non-ok responses: tries to parse `{detail}` from the JSON body, throws with that message

Returns `undefined` for `204 No Content`, otherwise parses JSON.

---

## `api` — lines 48–53

The exported object. Convenience wrappers over `apiFetch`:
- `api.get<T>(path)` — `GET`
- `api.post<T>(path, body?)` — `POST`
- `api.put<T>(path, body?)` — `PUT`
- `api.delete<T>(path)` — `DELETE`

**Called by:** [[frontend/src/context/AuthContext#logout]] · [[frontend/src/pages/Login/Login#handleSubmit]]
