---
name: main.tsx
description: Vite entry point — mounts the React root, imports global CSS
type: file
layer: entry
tags: [entry, vite, react]
imports:
  - "[[frontend/src/App]]"
  - "[[frontend/src/styles/_styles]]"
---

# `src/main.tsx`

Vite's entry file. Creates the React root on `#root` and renders `App` inside `StrictMode`. Also imports global styles in the correct order: CopilotKit UI styles → design tokens → globals → local.

**Imports:** [[frontend/src/App]] · [[frontend/src/styles/_styles]]
