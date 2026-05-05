# Login

**File:** `frontend/src/pages/Login/Login.tsx`  
**Route:** `/login`

Login and registration page. Left column is the form; right column shows a live auth-flow diagram.

## Functions

| Function | Lines | Notes |
|----------|-------|-------|
| `Login` (component) | 27–171 | Page shell — reads `?error=` param to show OAuth errors |
| `handleGoogleAuth` | 49–51 | Hard-navigates to `/api/v1/auth/google` (bypasses `apiFetch`) |
| `handleSubmit` | 53–59 | On signup: `POST /register` then `POST /login`; on signin: `POST /login` only |

## Calls

→ [[api]] (`api.post /api/v1/auth/register`, `api.post /api/v1/auth/login`)  
→ [[AuthContext]] (`useAuth` → `setUser`)

## Data flow

```
User fills form
  └─► handleSubmit
        └─► api.post /api/v1/auth/register   (signup only)
        └─► api.post /api/v1/auth/login
              └─► [[auth-controller]].login
                    └─► [[AuthService]].login
                    └─► sets HttpOnly cookies
              └─► setUser(user) → AuthContext
              └─► navigate("/home")

User clicks Google
  └─► window.location = /api/v1/auth/google
        └─► [[auth-controller]].google_login → redirect → Google → callback
```
