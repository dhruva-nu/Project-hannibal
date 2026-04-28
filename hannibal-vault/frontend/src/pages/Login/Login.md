---
name: Login.tsx
description: Login/register page — sign in, create account, Google OAuth, error handling from OAuth redirect
type: file
layer: pages
tags: [page, login, auth, oauth]
imports:
  - "[[frontend/src/context/AuthContext]]"
  - "[[frontend/src/services/api]]"
  - "[[frontend/src/hooks/useTheme]]"
  - "[[frontend/src/shared/components/organisms/LoginForm]]"
  - "[[frontend/src/shared/components/organisms/AuthFlowDiagram]]"
  - "[[frontend/src/shared/types/types]]"
---

# `src/pages/Login/Login.tsx`

Auth page. Handles both `signin` and `signup` modes via a tab toggle. The right column shows a static `AuthFlowDiagram` that explains what happens on login.

**Imports:** [[frontend/src/context/AuthContext]] · [[frontend/src/services/api]] · [[frontend/src/hooks/useTheme]] · [[frontend/src/shared/components/organisms/LoginForm]] · [[frontend/src/shared/components/organisms/AuthFlowDiagram]] · [[frontend/src/shared/types/types]]

---

## `Login` component — lines 27–172

Page orchestrator. Reads `?error=` query param from the URL (set by the backend on OAuth failure) and maps it to a human-readable message via `useMemo`. Manages `activeTab` state (`signin` | `signup`).

Renders: nav bar with `NavBrand` + `ThemeToggle` → left auth column → right diagram column.

---

## `handleGoogleAuth` — line 49–51

Redirects `window.location.href` to `/api/v1/auth/google` to kick off the Google OAuth flow. A hard redirect (not a fetch) because the backend needs to set the CSRF state cookie and then redirect to Google.

---

## `handleSubmit` — lines 53–60

Called by [[frontend/src/shared/components/organisms/LoginForm]] on form submit. If in `signup` mode, first calls `POST /api/v1/auth/register` via [[frontend/src/services/api#api]], then always calls `POST /api/v1/auth/login`. On success, calls `setUser` from [[frontend/src/context/AuthContext#useAuth]] and navigates to `/home`.

**Calls:** [[frontend/src/services/api#api]] · [[frontend/src/context/AuthContext#useAuth]]
