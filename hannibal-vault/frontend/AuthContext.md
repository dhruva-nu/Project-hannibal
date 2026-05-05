# AuthContext

**File:** `frontend/src/context/AuthContext.tsx`

Holds the authenticated `user` object and exposes it to all child components via React Context. Bootstraps session on mount by hitting `/auth/me`.

## Exports

| Export | Type | Purpose |
|--------|------|---------|
| `AuthProvider` | Component | Wraps app tree, owns `user` + `loading` state |
| `useAuth` | Hook | Returns `{ user, loading, setUser, logout }` |

## Functions

| Function | Lines | Notes |
|----------|-------|-------|
| `AuthProvider` | 15–42 | Fetches `/api/v1/auth/me` on mount to restore session from cookie |
| `logout` | 27–34 | Calls `POST /api/v1/auth/logout`, clears `user`, navigates to `/login` |
| `useAuth` | 45–49 | Throws if used outside `AuthProvider` |

## Calls

→ [[api]] (`api.post /api/v1/auth/logout`)

## Data flow

Cookie in browser → `GET /api/v1/auth/me` → [[auth-controller]].`me` → `user` state set
