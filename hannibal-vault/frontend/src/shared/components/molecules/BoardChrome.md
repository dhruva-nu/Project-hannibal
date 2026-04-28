---
name: BoardChrome
description: Tab bar header for the canvas shell — file tabs + optional meta label (e.g. "tutor · live")
type: file
layer: ui
tags: [molecule, chrome, tabs]
---

# `molecules/BoardChrome/BoardChrome.tsx`

**Used by:** [[frontend/src/shared/components/organisms/CanvasBoard]] · [[frontend/src/shared/components/organisms/AuthFlowDiagram]]

Renders the top bar of a canvas-style panel: a row of file tabs (active tab is underlined) and an optional `metaLabel` on the right (e.g. `"tutor · live"`). Purely presentational — no tab switching logic.
