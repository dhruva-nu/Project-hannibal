# Auth

JWT + HttpOnly cookies. Supports local (email/password) and Google OAuth. Refresh tokens are revocable, access tokens are short-lived. The FE refreshes silently on 401.

## End-to-end flow

### 1. Sign in (local)

```
User submits LoginForm (organisms/LoginForm/LoginForm.tsx)
   ↓ onSubmit
Login.tsx:30-37  (frontend/src/pages/Login/Login.tsx)
   ↓ POST /api/v1/auth/login  with { email, password }, credentials: "include"
auth_controller.login                    (backend/app/api/v1/controllers/auth_controller.py:110-132)
   ↓
AuthService.login                        (backend/app/services/auth_service.py:35-42)
   ├─ UserRepository.get_by_email        (backend/app/repositories/user_repository.py:10-11)
   ├─ bcrypt.checkpw  (constant-time)
   └─ AuthService._issue_tokens          (backend/app/services/auth_service.py:160-170)
       ├─ _create_access_token  (15 min, claims: sub, email, role)
       ├─ _create_refresh_token (7 days, claims: sub, email, role, jti)
       └─ RefreshTokenRepository.create  (backend/app/repositories/refresh_token_repository.py:12-17)
   ↓
auth_controller._set_auth_cookies        (sets both cookies, HttpOnly, SameSite=Lax)
   ↓
Login.tsx sets AuthContext.user → navigate("/home")
```

### 2. Sign in (Google OAuth)

```
User clicks "Continue with Google" in LoginForm
   ↓
Login.tsx:76  → window.location.href = "/api/v1/auth/google"
auth_controller.google                   (auth_controller.py:211-219)
   ├─ AuthService.generate_oauth_state   → base64(rand_32) + "." + HMAC-SHA256
   ├─ writes httponly cookie "oauth_state" (TTL 5m)
   └─ 302 → https://accounts.google.com/o/oauth2/v2/auth?…
User authorizes → Google redirects back
   ↓
GET /api/v1/auth/google/callback?code=…&state=…
auth_controller.google_callback          (auth_controller.py:222-250)
   ├─ AuthService.verify_oauth_state     (hmac.compare_digest, timing-safe)
   ├─ exchanges code → Google access token (httpx)
   ├─ fetches userinfo
   ├─ UserRepository.get_or_create_oauth_user
   │     (user_repository.py:23-38) — upsert by oauth_id, else attach by email
   ├─ AuthService._issue_tokens
   └─ sets cookies → 302 → FRONTEND_ORIGIN/home
```

OAuth-email collision: if a Google user's email matches an existing **local** user, the existing row is updated with `provider="google"` + `oauth_id`. No duplicate user, one account works for both methods.

### 3. Authenticated request

```
Browser sends cookies automatically (credentials: "include" everywhere).
api.ts fetches /api/v1/<anything>      (frontend/src/services/api.ts:10-46)
   ↓
FastAPI route depends on require_auth   (backend/app/dependencies/auth.py:17-35)
   ├─ reads cookie "access_token" OR Authorization: Bearer <token>
   ├─ AuthService.verify_token  (jose.jwt.decode, raises on bad sig/exp)
   └─ returns payload { sub, email, role, exp }
```

### 4. Silent refresh on 401

```
api.ts apiFetch                         (api.ts:21-31)
   if response.status === 401 and path ∉ SKIP_REFRESH:
      POST /api/v1/auth/refresh
      if ok: retry the original request
      else: window.location.href = "/login"

SKIP_REFRESH = ["/auth/login", "/auth/refresh", "/auth/register"]   (api.ts:8)
```

The BE side:

```
auth_controller.refresh                  (auth_controller.py:178-208)
   └─ AuthService.refresh                (auth_service.py:44-64)
      ├─ jose.jwt.decode(refresh_token)
      ├─ RefreshTokenRepository.get_by_jti  (refresh_token_repository.py:19-20)
      ├─ assert not revoked, not expired
      └─ issues NEW access token (refresh token jti is NOT rotated)
```

The refresh token JTI stays the same for its full 7-day lifetime. Logout is the only way to revoke it.

### 5. Logout

```
AuthContext.logout                       (frontend/src/context/AuthContext.tsx:27-35)
   ↓ POST /api/v1/auth/logout
auth_controller.logout                   (auth_controller.py:160-175)
   ├─ AuthService.logout                 (auth_service.py:66-75)
   │     └─ RefreshTokenRepository.revoke_by_jti  → row.revoked = True
   └─ clears both cookies
   ↓
AuthContext: setUser(null) → navigate("/login")
```

## Frontend pieces

| File | Lines | Role |
|---|---|---|
| `frontend/src/pages/Login/Login.tsx` | 1-86 | Page wrapper. Wires LoginForm, parses `?error=` query for OAuth failures, redirects to `/home` on success. |
| `frontend/src/pages/Login/login.constants.ts` | 1-16 | Tab list, trust pills, OAuth-error→message map. |
| `frontend/src/pages/Login/LoginDemoCol.tsx` | 1-24 | Right column with the educational AuthFlowDiagram. |
| `frontend/src/shared/components/organisms/LoginForm/LoginForm.tsx` | 1-117 | Email + password form, signin/signup toggle, "Continue with Google" button. |
| `frontend/src/shared/components/organisms/AuthFlowDiagram/AuthFlowDiagram.tsx` | 1-116 | Static SVG swimlane explaining the flow (browser / API / vault). Pure visual. |
| `frontend/src/shared/components/molecules/OAuthButton/OAuthButton.tsx` | 1-43 | Stateless button with provider icon. |
| `frontend/src/context/AuthContext.tsx` | 1-51 | `AuthProvider` bootstraps `user` via `auth.getCurrentUser()` on mount (errors → logged out); exposes `{ user, loading, setUser, logout }`. |
| `frontend/src/services/auth.ts` | 1-19 | `getCurrentUser` / `login` / `register` / `logout` — the only auth HTTP calls. |
| `frontend/src/services/api.ts` | 1-54 | `apiFetch` helper. Adds `credentials: "include"`, handles 401 → refresh → retry. |

The protected-route guard is in `App.tsx:21-26`. It shows a `Spinner` while `loading=true`, redirects to `/login` when `user === null`, and wraps the page in an `ErrorBoundary`.

## Backend pieces

| File | Lines | Role |
|---|---|---|
| `backend/app/api/v1/controllers/auth_controller.py` | 1-251 | Routes (see below). `_write_httponly_cookie` (20-30) and `_set_auth_cookies` (~131) own cookie attributes. |
| `backend/app/services/auth_service.py` | 1-197 | All business logic: hashing, JWT issue/verify, OAuth state + callback, refresh. |
| `backend/app/repositories/user_repository.py` | 1-57 | 5 methods: `get_by_email`, `get_by_id`, `get_by_oauth_id`, `get_or_create_oauth_user`, `create`. |
| `backend/app/repositories/refresh_token_repository.py` | 1-27 | 3 methods: `create`, `get_by_jti`, `revoke_by_jti`. |
| `backend/app/schemas/auth.py` | 1-21 | `RegisterRequest`, `LoginRequest`, `UserResponse`. |
| `backend/app/dependencies/auth.py` | 1-43 | `get_auth_service`, `require_auth`, `require_admin`. |

### Routes (all under `/api/v1/auth`)

| Method | Path | Body | Returns | Notes |
|---|---|---|---|---|
| GET | `/me` | — | `UserResponse` | Requires `access_token`. |
| POST | `/register` | `RegisterRequest` | `UserResponse` (201) | Does **not** auto-login. Caller must POST `/login`. Password ≥ 8 chars. |
| POST | `/login` | `LoginRequest` | `UserResponse` + cookies | Sets both cookies on success. |
| POST | `/token` | OAuth2 form | `{access_token, token_type:"bearer"}` | JSON only — for non-browser clients. No cookies. |
| POST | `/logout` | — | 204 | Revokes refresh JTI, clears cookies. |
| POST | `/refresh` | — | 204 + new access cookie | Refresh JTI is not rotated. |
| GET | `/google` | — | 302 → Google | Sets `oauth_state` cookie. |
| GET | `/google/callback` | `?code&state` | 302 → frontend | Verifies state, exchanges code, issues tokens. |

## Cookies

Set via `_write_httponly_cookie` (`auth_controller.py:20-30`):

| Attribute | Value | Why |
|---|---|---|
| `HttpOnly` | `True` | JS can't read it → XSS can't steal the token. |
| `SameSite` | `"lax"` | Needed for the Google callback redirect (cross-site GET). Slightly weaker than `Strict`. |
| `Secure` | `settings.cookie_secure` | False in dev (HTTP), True in prod (HTTPS). |
| `Path` | `/` | |
| `Max-Age` | matches token TTL | 15 min for access, 7 days for refresh. |

## Configuration

From `backend/app/core/config.py`:

| Env var | Default | Used by |
|---|---|---|
| `SECRET_KEY` | `"change-me-in-production"` | JWT sign + HMAC for OAuth state. |
| `JWT_ALGORITHM` | `HS256` | |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `15` | |
| `REFRESH_TOKEN_EXPIRE_DAYS` | `7` | |
| `COOKIE_SECURE` | `False` | Set true in prod. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | — | Required for OAuth. |
| `GOOGLE_REDIRECT_URI` | `http://localhost:8000/api/v1/auth/google/callback` | Must match Google console exactly. |
| `FRONTEND_ORIGIN` | `http://localhost:5173` | Where the callback redirects to. |

## Database

[`users`](../01-database.md#users) and [`refresh_tokens`](../01-database.md#refresh_tokens) — see the schema doc.

## Surprises

- **Register does not log you in.** Login.tsx (`pages/Login/Login.tsx:31-34`) explicitly POSTs `/login` right after `/register`.
- **No refresh-token rotation.** A leaked refresh token is valid until logout. If rotation becomes a requirement, the place to add it is `AuthService.refresh` (`auth_service.py:44-64`) — issue a new JTI, revoke the old one, write a new cookie.
- **Default role conflict.** `User.role` defaults to `admin` at the SQL level (`user.py:20`), but `UserRepository.create` (`user_repository.py:52`) explicitly passes `"student"`. If a row is ever inserted without going through the repository it will be `admin`. Audit before trusting `role` in production.
- **OAuth state lives in a cookie, not in memory.** 5-minute TTL. If two browser tabs start OAuth simultaneously, the second overwrites the first.
