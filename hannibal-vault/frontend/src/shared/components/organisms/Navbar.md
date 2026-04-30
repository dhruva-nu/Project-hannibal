---
name: Navbar
description: Top navigation bar — brand, nav links, theme toggle, and logout or CTA button
type: file
layer: ui
tags: [organism, navbar, navigation]
imports:
  - "[[frontend/src/shared/components/atoms/_atoms]]"
  - "[[frontend/src/shared/components/molecules/_molecules]]"
  - "[[frontend/src/shared/types/types]]"
---

# `organisms/Navbar/Navbar.tsx`

**Imports:** `Button`, `ThemeToggle` (atoms) · `NavBrand` (molecule) · [[frontend/src/shared/types/types]] (`NavLink`, `Theme`)

**Used by:** [[frontend/src/pages/Home/Home]] · [[frontend/src/pages/Courses/Courses]]

---

## `Navbar` component — lines 22–52

Props: `links` (default nav links), `theme`, `onThemeToggle`, optional `onLogout`.

If `onLogout` is provided (Home page), renders a "Sign out" ghost button. Otherwise renders the "Start building →" CTA link. This is the only conditional rendering — everything else is data-driven from `links`.

Renders: `NavBrand` → nav links → `ThemeToggle` → CTA or logout button.
