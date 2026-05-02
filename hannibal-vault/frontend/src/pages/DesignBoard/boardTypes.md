---
name: boardTypes
description: Shared TypeScript types for the DesignBoard feature — nodes, edges, ports, palette entries
type: file
layer: pages
tags: [types, diagram, design-board]
---

# `pages/DesignBoard/boardTypes.ts`

**Imports:** `PortPosition` from [[frontend/src/shared/components/atoms/PortDot]]

**Used by:** [[frontend/src/pages/DesignBoard/useDesignBoard]] · [[frontend/src/shared/components/molecules/PaletteItem]] · [[frontend/src/shared/components/molecules/BoardNode]] · [[frontend/src/shared/components/molecules/ServiceBlock]] · [[frontend/src/shared/components/organisms/DesignCanvas]] · [[frontend/src/shared/components/organisms/DesignInspector]]

---

## Key types

| Type | Purpose |
|---|---|
| `PortPosition` | Re-export of `"l" \| "r" \| "t" \| "b"` from PortDot atom |
| `BoardModule` | `{ id, label }` — a module inside a service |
| `BoardNodeData` | Full node: `id`, `type: "component" \| "service"`, `x`, `y`, `w?`, `label`, `modules?` |
| `EdgeEndpoint` | `{ nodeId, moduleId?, port }` — one end of an edge |
| `BoardEdge` | `{ id, from: EdgeEndpoint, to: EdgeEndpoint }` |
| `PendingEdge` | In-progress drag: origin fields + current cursor `x, y` |
| `SelectedItem` | `{ kind: "node"\|"service"\|"module"\|"edge", id, moduleId? }` |
| `PaletteEntry` | `{ kind: PaletteKind, label }` — one draggable palette row |
| `PaletteSection` | `{ title, items: PaletteEntry[], tip? }` — one palette group |
