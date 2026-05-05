# auth-controller

**File:** `backend/app/api/v1/controllers/auth_controller.py`  
**Router prefix:** `/api/v1/auth`

## Endpoints

| Method | Path | Function | Lines | Auth |
|--------|------|----------|-------|------|
| `GET` | `/me` | `me` | 44–52 | ✅ `require_auth` |
| `POST` | `/register` | `register` | 55–68 | ❌ |
| `POST` | `/login` | `login` | 71–85 | ❌ |
| `POST` | `/logout` | `logout` | 88–101 | ❌ |
| `POST` | `/refresh` | `refresh` | 104–118 | ❌ (uses cookie) |
| `GET` | `/google` | `google_login` | 121–129 | ❌ |
| `GET` | `/google/callback` | `google_callback` | 132–155 | ❌ |

## Helper functions

| Function | Lines | Notes |
|----------|-------|-------|
| `_write_httponly_cookie` | 19–27 | Sets secure, samesite=lax HttpOnly cookie |
| `_set_auth_cookies` | 30–32 | Writes both `access_token` + `refresh_token` cookies |
| `_clear_auth_cookies` | 35–37 | Deletes both cookies |
| `_login_error_redirect` | 40–41 | Redirects to `/login?error=<code>` |

## Calls

→ [[AuthService]]
