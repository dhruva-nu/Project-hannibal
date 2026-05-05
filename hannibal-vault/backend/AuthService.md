# AuthService

**File:** `backend/app/services/auth_service.py`  
**Class:** `AuthService`

## Methods

| Method | Lines | Notes |
|--------|-------|-------|
| `register` | 26–31 | Checks duplicate email, bcrypt-hashes password, creates user |
| `login` | 33–46 | Verifies password, issues access + refresh JWT, stores refresh token |
| `refresh` | 48–64 | Decodes refresh token, checks DB record not revoked/expired, issues new access token |
| `logout` | 66–73 | Decodes refresh token, revokes jti in DB (best-effort) |
| `get_user_by_email` | 75–79 | Simple lookup for `GET /me` |
| `verify_token` | 81–85 | Decodes access JWT — throws `ValueError` on invalid |
| `generate_oauth_state` | 87–91 | `secrets.token_urlsafe(32)` + HMAC SHA-256 signature |
| `verify_oauth_state` | 93–99 | HMAC compare_digest to prevent timing attacks |
| `get_google_auth_url` | 101–111 | Builds Google OAuth2 redirect URL |
| `handle_google_callback` | 113–151 | Exchanges code for Google token, fetches userinfo, upserts user, issues tokens |
| `_create_access_token` | 153–156 | Signs JWT with `exp` claim |
| `_create_refresh_token` | 158–166 | Signs JWT with `jti` + `exp` claim |

## Calls

→ [[UserRepository]]  
→ [[RefreshTokenRepository]]
