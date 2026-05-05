# UserRepository

**File:** `backend/app/repositories/user_repository.py`  
**Model:** `backend/app/models/user.py` — `User(id, email, hashed_password, provider, oauth_id, created_at, role)`

## Methods

| Method | Lines | Query |
|--------|-------|-------|
| `get_by_email` | 10–11 | `WHERE email = ?` |
| `get_by_id` | 13–14 | `WHERE id = ?` |
| `get_by_oauth_id` | 16–17 | `WHERE provider = ? AND oauth_id = ?` |
| `get_or_create_oauth_user` | 19–30 | Lookup by oauth_id → email → create (upsert for Google OAuth) |
| `create` | 32–36 | INSERT user |

## Called by

← [[AuthService]]  
← [[copilotkit-controller]] (direct — `get_user_profile` tool)
