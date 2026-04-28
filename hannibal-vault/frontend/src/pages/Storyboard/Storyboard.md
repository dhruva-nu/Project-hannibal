---
name: Storyboard.tsx
description: Internal component library browser — renders every atom, molecule, and organism with demo data; not routed
type: file
layer: pages
tags: [page, storyboard, component-library, dev-tool]
imports:
  - "[[frontend/src/shared/components/atoms/_atoms]]"
  - "[[frontend/src/shared/components/molecules/_molecules]]"
  - "[[frontend/src/shared/components/organisms/_organisms]]"
  - "[[frontend/src/hooks/useTheme]]"
---

# `src/pages/Storyboard/Storyboard.tsx`

A developer-facing component explorer. Not added to the router in [[frontend/src/App]] — accessible only if manually routed or mounted. Renders all 12 atoms, 11 molecules, and 8 organisms with hardcoded demo data.

Useful for visual regression checks and design review without needing a real backend.

**Imports:** All atoms, molecules, organisms · [[frontend/src/hooks/useTheme]]

---

## `Storyboard` component — lines 135–535

Renders a sidebar navigation (Atoms / Molecules / Organisms) and a scrollable main area with `StoryCard` and `OrgStory` wrappers around each component. Clicking a sidebar item smooth-scrolls to the corresponding section.

Uses `handleChatSubmit` to let the demo `ChatPanel` actually accept messages (appends them to the demo message list).

**Calls:** Every shared component in the design system
