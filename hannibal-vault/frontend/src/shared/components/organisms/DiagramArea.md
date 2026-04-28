---
name: DiagramArea
description: Draggable node canvas with live SVG edge routing — nodes can be dragged and edges reflow automatically
type: file
layer: ui
tags: [organism, diagram, draggable, svg]
imports:
  - "[[frontend/src/shared/components/molecules/_molecules]]"
  - "[[frontend/src/shared/types/types]]"
---

# `organisms/DiagramArea/DiagramArea.tsx`

**Imports:** `DiagramNode` (molecule) · [[frontend/src/shared/types/types]] (`DiagramNodeData`, `DiagramEdge`)

**Used by:** [[frontend/src/pages/Home/HeroRight]] · [[frontend/src/pages/Storyboard/Storyboard]]

---

## `DiagramArea` component — lines 56–133

Manages `nodes` positions in state (drag updates them via `handleMove`). On every render, computes SVG `<path>` strings for all edges using DOM measurements (getBoundingClientRect) and draws them as dashed curved arrows in an overlay SVG.

A `forceRender` counter ensures the SVG re-draws after mount (when `areaRef` becomes non-null) and on window resize.

---

## `handleMove` — lines 74–77

Callback passed to each `DiagramNode`. Receives `(id, x, y)` and updates the node's position in state, then triggers a re-render so edges reflow to the new position.

---

## `buildEdgePath` — lines 38–47

Computes a quadratic Bézier SVG path (`M … Q … `) between two nodes. Uses `getNodeCenter` to get DOM positions, then `edgePoint` to find the exact point on each node's bounding box where the arrow should start/end. Offsets the control point upward by `14 + index * 4` to prevent overlapping parallel edges.
