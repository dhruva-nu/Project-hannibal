---
name: useTheme.ts
description: Theme hook — manages light/dark state and syncs it to data-theme on the document root
type: file
layer: state
tags: [hook, theme, dark-mode]
imports:
  - "[[frontend/src/shared/types/types]]"
---

# `src/hooks/useTheme.ts`

**Imports:** [[frontend/src/shared/types/types]] (`Theme`)

**Used by:** [[frontend/src/pages/Login/Login]] · [[frontend/src/pages/Home/Home]] · [[frontend/src/pages/Storyboard/Storyboard]]

---

## `useTheme` — lines 4–13

Holds `theme: "light" | "dark"` in state. A `useEffect` syncs the value to `document.documentElement.setAttribute("data-theme", theme)` whenever it changes — this is what triggers the CSS custom property overrides in [[frontend/src/styles/_styles]].

Returns `{ theme, toggleTheme }`.
