# RefreshTokenRepository

**File:** `backend/app/repositories/refresh_token_repository.py`  
**Model:** `backend/app/models/refresh_token.py` — `RefreshToken(id, user_id FK, jti, expires_at, revoked)`

## Methods

| Method | Lines | Query |
|--------|-------|-------|
| `create` | 12–16 | INSERT refresh token record |
| `get_by_jti` | 18–19 | `WHERE jti = ?` |
| `revoke_by_jti` | 21–25 | Sets `revoked = True`, commits |

## Called by

← [[AuthService]]
