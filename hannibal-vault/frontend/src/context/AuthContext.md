---
name: AuthContext.tsx
description: Global auth state — AuthProvider holds the logged-in user, exposes useAuth hook and logout
type: file
layer: state
tags: [context, auth, hooks, copilotkit]
imports:
  - "[[frontend/src/services/api]]"
  - "[[frontend/src/shared/types/types]]"
---

# `src/context/AuthContext.tsx`

Central auth state for the entire app. Wraps children in `AuthContext.Provider` so any component can call `useAuth()` to get the current user or trigger logout.

**Imports:** [[frontend/src/services/api]] · [[frontend/src/shared/types/types]]

**Used by:** [[frontend/src/App]] (wraps the whole tree) · [[frontend/src/pages/Login/Login]] · [[frontend/src/pages/Home/Home]]

---

## `AuthProvider` — lines 15–38

React context provider. Holds `user: User | null` in state and exposes `setUser` and `logout`.

Also calls `useCopilotReadable` to pipe the current user's `id`, `email`, and `provider` into the CopilotKit AI context — so the AI agent knows who is logged in.

**Calls:** [[frontend/src/services/api]] (via `logout`) · `useCopilotReadable`

---

## `logout` — lines 24–32

Async function inside `AuthProvider`. Calls `POST /api/v1/auth/logout` via [[frontend/src/services/api#api]], then clears `user` to `null` and navigates to `/login`.

**Calls:** [[frontend/src/services/api#api]]

---

## `useAuth` — lines 42–46

Custom hook. Returns the `AuthContextValue` (`user`, `setUser`, `logout`) from the nearest `AuthProvider`. Throws if called outside the provider.

**Used by:** [[frontend/src/pages/Login/Login]] · [[frontend/src/pages/Home/Home]]
