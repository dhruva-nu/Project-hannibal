---
name: DesignCanvas
description: Main drawing canvas — renders BoardNodes and ServiceBlocks, draws SVG Bézier edges, handles palette drops and pending edge tracking
type: file
layer: ui
tags: [organism, diagram, canvas, svg, drag-and-drop]
imports:
  - "[[frontend/src/shared/components/molecules/BoardNode]]"
  - "[[frontend/src/shared/components/molecules/ServiceBlock]]"
  - "[[frontend/src/pages/DesignBoard/boardTypes]]"
---

# `organisms/DesignCanvas/DesignCanvas.tsx`

**Imports:** `BoardNode` + `ServiceBlock` (molecules) · types from [[frontend/src/pages/DesignBoard/boardTypes]]

**Used by:** [[frontend/src/pages/DesignBoard/DesignBoard]]

---

## Layout

```
.wrap (overflow: hidden, relative)
  ├── .helpPill          — "drag from palette…" hint (pointer-events: none)
  ├── .frame             — decorative border inset 22px
  ├── .label             — "System design" in Caveat font (pointer-events: none)
  └── .canvas (scrollable, 2400×1600 inner)
        └── .inner (position: relative)
              ├── <svg .svg>       — edge paths rendered on top (z-index: 2)
              └── BoardNode × N   or  ServiceBlock × N  (z-index: 2-3)
```

## Edge rendering — lines 47–84 (`useLayoutEffect`)

After every render, reads DOM bounding boxes via `innerRef.current.querySelector(...)` to compute exact port anchor coordinates. Builds Bézier SVG path strings (`M … C …`), then:

1. Stringifies old vs new paths
2. Only calls `setTick(t => t + 1)` if they differ — prevents infinite re-render loop
3. Stores computed paths in `edgePathsRef` (read-only during render)

Edge style: dashed `--accent-3` for module→component; solid `--ink` for service-level edges.

## Pending edge — `pendingPathRef`

A straight `L` line from the port anchor to the current cursor position, updated on every `pointermove` via state in [[frontend/src/pages/DesignBoard/useDesignBoard]].

## Drop handler — lines 86–93

Reads `kind` and `label` from `dataTransfer`, translates `clientX/Y` to canvas-inner coordinates, delegates to `onDrop` prop → [[frontend/src/pages/DesignBoard/useDesignBoard#handleDrop]].

## Props

| Prop | Type | Purpose |
|---|---|---|
| `nodes` | `Record<string, BoardNodeData>` | All nodes to render |
| `edges` | `BoardEdge[]` | Edges to draw as SVG paths |
| `pending` | `PendingEdge \| null` | In-progress edge line from port to cursor |
| `selected` | `SelectedItem \| null` | Passed to nodes/services for selection ring |
| `innerRef` | `RefObject<HTMLDivElement>` | Ref to the 2400×1600 inner div; also used by hook for `findServiceAt` and `startEdge` coordinate calculation |
| `onPortPointerDown/Up` | callbacks | Edge start/finish — wired to [[frontend/src/pages/DesignBoard/useDesignBoard#startEdge]] / `finishEdge` |
| `onDrop` | `(kind, label, x, y) => void` | Palette item dropped onto canvas |
| `onAddModule` | `(serviceId, label) => void` | Forwarded from ServiceBlock's add-module button |
