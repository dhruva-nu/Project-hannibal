# api

**File:** `frontend/src/services/api.ts`

Shared HTTP client. All FE→BE calls go through here — never raw `fetch()` in components or context.

## Key behaviour

- Sets `credentials: "include"` on every request (sends HttpOnly cookies)
- On 401 response: silently calls `POST /api/v1/auth/refresh`, then retries the original request once
- On second 401 (refresh failed): redirects to `/login`
- Paths in `SKIP_REFRESH` (`/auth/login`, `/auth/refresh`, `/auth/register`) skip the retry loop

## Functions

| Symbol | Lines | Notes |
|--------|-------|-------|
| `apiFetch<T>` | 10–45 | Core wrapper — handles 401 retry, JSON parsing, 204 guard |
| `api.get` | 49 | `GET` shorthand |
| `api.post` | 50 | `POST` shorthand |
| `api.put` | 51 | `PUT` shorthand |
| `api.delete` | 52 | `DELETE` shorthand |

## Called by

← [[Login]]  
← [[AuthContext]]  
← [[courses-service]]  
← [[courseDetail-service]]
