---
name: context (folder)
description: React context providers — global state shared across the component tree
type: folder
layer: state
tags: [folder, context, state]
---

# `src/context/`

Global React context. Currently one provider — `AuthContext` — which manages the logged-in user and logout flow.

## Files

- [[frontend/src/context/AuthContext]] — `AuthProvider` + `useAuth()` — user state, logout, CopilotKit user feed
