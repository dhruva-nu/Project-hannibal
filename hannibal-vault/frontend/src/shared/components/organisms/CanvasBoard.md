---
name: CanvasBoard
description: Outer shell of the interactive diagram+chat panel — dotted grid background, chrome header, children slot
type: file
layer: ui
tags: [organism, canvas, shell]
imports:
  - "[[frontend/src/shared/components/molecules/_molecules]]"
---

# `organisms/CanvasBoard/CanvasBoard.tsx`

**Imports:** `BoardChrome` (molecule)

**Used by:** [[frontend/src/pages/Home/HeroRight]] · [[frontend/src/pages/Storyboard/Storyboard]]

---

## `CanvasBoard` component — lines 20–27

Thin wrapper that renders `BoardChrome` (the tab bar + meta label header) and a `body` slot that accepts `children`. The dotted grid background comes from CSS.

Props: `tabs`, optional `metaLabel`, `children`.

Children used in practice: [[frontend/src/shared/components/organisms/DiagramArea]] + [[frontend/src/shared/components/organisms/ChatPanel]].
