---
name: BoardNode
description: Absolutely positioned component node on the DesignCanvas — draggable via pointer capture, exposes 4 PortDots for edge connections
type: file
layer: ui
tags: [molecule, diagram, draggable, node]
imports:
  - "[[frontend/src/shared/components/atoms/PortDot]]"
  - "[[frontend/src/pages/DesignBoard/boardTypes]]"
---

# `molecules/BoardNode/BoardNode.tsx`

**Imports:** `PortDot` (atom) · `BoardNodeData`, `PortPosition`, `SelectedItem` from [[frontend/src/pages/DesignBoard/boardTypes]]

**Used by:** [[frontend/src/shared/components/organisms/DesignCanvas]]

---

Renders one `"component"` node (DB, Redis, Client, etc.) on the canvas. Uses `setPointerCapture` on the element ref so drag works even when the cursor leaves the element.

## Drag — lines 22–33

On `pointerDown` (not on a port), records start position and calls `setPointerCapture`. On `pointerMove`, computes delta and calls `onMove(id, x, y)` clamped to `max(0, ...)`. `onMove` updates state in [[frontend/src/pages/DesignBoard/useDesignBoard]], which propagates back as a new `left`/`top` style.

## Port wiring — lines 36–44

Renders four `PortDot` atoms (`l`, `r`, `t`, `b`). Each forwards pointer events to:
- `onPortPointerDown` → [[frontend/src/pages/DesignBoard/useDesignBoard#startEdge]] to begin a pending edge
- `onPortPointerUp` → [[frontend/src/pages/DesignBoard/useDesignBoard#finishEdge]] to complete the connection

## Props

| Prop | Type | Purpose |
|---|---|---|
| `node` | `BoardNodeData` | Position, id, label |
| `selected` | `boolean` | Renders accent ring when true |
| `onSelect` | `(SelectedItem) => void` | Notifies parent of click selection |
| `onMove` | `(id, x, y) => void` | Called on every drag frame |
| `onPortPointerDown` | `(e, nodeId, undefined, port) => void` | Starts an edge |
| `onPortPointerUp` | `(nodeId, undefined, port) => void` | Finishes an edge |
