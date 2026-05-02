---
name: DesignInspector
description: Right sidebar inspector for DesignBoard — shows edit/delete controls for the selected node, module, or edge
type: file
layer: ui
tags: [organism, diagram, inspector]
imports:
  - "[[frontend/src/pages/DesignBoard/boardTypes]]"
---

# `organisms/DesignInspector/DesignInspector.tsx`

**Imports:** `BoardNodeData`, `BoardEdge`, `SelectedItem` from [[frontend/src/pages/DesignBoard/boardTypes]]

**Used by:** [[frontend/src/pages/DesignBoard/DesignBoard]]

---

Stateless inspector panel — all edits call back to [[frontend/src/pages/DesignBoard/useDesignBoard]]. Renders one of four states based on `selected`:

| `selected` | Content |
|---|---|
| `null` | Empty state — Caveat-font hint "click a component…" |
| `{ kind: "edge" }` | Connection endpoints as pill + delete button |
| `{ kind: "module" }` | Module name input + "inside service · {label}" pill + delete |
| `{ kind: "node" \| "service" }` | Label input + type pill + (service only) modules list + delete |

## Props

| Prop | Type | Purpose |
|---|---|---|
| `nodes` | `Record<string, BoardNodeData>` | Full node map for label/type lookup |
| `edges` | `BoardEdge[]` | Edge list for edge selection display |
| `selected` | `SelectedItem \| null` | Drives which form variant renders |
| `onUpdateLabel` | `(nodeId, label, moduleId?) => void` | Live label edit on input `onChange` |
| `onDeleteNode` | `(nodeId) => void` | Removes node + all its edges from state |
| `onDeleteModule` | `(nodeId, moduleId) => void` | Removes module + edges touching it |
| `onDeleteEdge` | `(edgeId) => void` | Removes one edge |
