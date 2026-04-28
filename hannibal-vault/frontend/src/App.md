---
name: App.tsx
description: React app root — sets up BrowserRouter, AuthProvider, CopilotKit, routes, and the AI popup
type: file
layer: entry
tags: [app, router, copilotkit, auth]
imports:
  - "[[frontend/src/context/AuthContext]]"
  - "[[frontend/src/pages/Login/Login]]"
  - "[[frontend/src/pages/Home/Home]]"
---

# `src/App.tsx`

The root component. Establishes the full provider tree and routing.

**Tree order:** `BrowserRouter > AuthProvider > CopilotKit > Routes + CopilotPopup`

**Imports:** [[frontend/src/context/AuthContext]] · [[frontend/src/pages/Login/Login]] · [[frontend/src/pages/Home/Home]]

---

## `App` component — lines 10–33

Sets up:
- `BrowserRouter` — enables React Router
- `AuthProvider` — wraps everything so `useAuth()` works anywhere
- `CopilotKit` — points to `VITE_COPILOTKIT_RUNTIME_URL` (defaults to `/api/v1/copilotkit`), makes AI available everywhere
- `Routes`:
  - `/login` → [[frontend/src/pages/Login/Login]]
  - `/home` → [[frontend/src/pages/Home/Home]]
  - `/` and `*` → redirect to `/home`
- `CopilotPopup` — the floating AI chat bubble, placed **outside** `Routes` so it persists across all pages

**Calls:** [[frontend/src/context/AuthContext]] · [[frontend/src/pages/Login/Login]] · [[frontend/src/pages/Home/Home]]
