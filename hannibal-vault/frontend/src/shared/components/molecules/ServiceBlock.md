---
name: ServiceBlock
description: Dashed service container on the DesignCanvas — draggable, holds up to 5 module rows each with their own PortDots
type: file
layer: ui
tags: [molecule, diagram, draggable, service, container]
imports:
  - "[[frontend/src/shared/components/atoms/PortDot]]"
  - "[[frontend/src/pages/DesignBoard/boardTypes]]"
---

# `molecules/ServiceBlock/ServiceBlock.tsx`

**Imports:** `PortDot` (atom) · `BoardNodeData`, `PortPosition`, `SelectedItem` from [[frontend/src/pages/DesignBoard/boardTypes]]

**Used by:** [[frontend/src/shared/components/organisms/DesignCanvas]]

---

Renders a `"service"` node — a dashed rounded container holding module rows and a Caveat-font label at the bottom.

## Structure

```
ServiceBlock (draggable div, z-index: 2)
  ├── .modules
  │     ├── moduleRow × N      — each has l/r PortDots
  │     └── .addBtn            — "add module" or "max 5 modules" (disabled)
  ├── PortDot × 4 (l/r/t/b)   — service-level ports, direct children
  └── .label                   — service name in Caveat font, bottom-left
```

## Drag — lines 23–35

Same pointer-capture pattern as [[frontend/src/shared/components/molecules/BoardNode]]. Guards against starting drag when pointer is on a port, module row, or the add button.

## Module selection — line 50

Clicking a module row calls `onSelect({ kind: "module", id: serviceId, moduleId: m.id })` so the [[frontend/src/shared/components/organisms/DesignInspector]] shows module-specific fields.

## Add module — lines 56–62

Calls `window.prompt()` for the module name (matching the original HTML behaviour). Disabled and styled `.full` once 5 modules are present.

## Port visibility

- Service-level ports: `.service:hover > [data-port-dot]`
- Module ports: `.moduleRow:hover [data-port-dot]`

Both use the unscoped `[data-port-dot]` attribute selector — see [[frontend/src/shared/components/atoms/PortDot]].

## Props

| Prop | Type | Purpose |
|---|---|---|
| `service` | `BoardNodeData` | Full service data including `modules[]` |
| `selected` | `boolean` | Accent border on service container |
| `selectedModuleId` | `string?` | Accent ring on a specific module row |
| `onSelect` | `(SelectedItem) => void` | Service or module selection |
| `onMove` | `(id, x, y) => void` | Drag frames for the whole container |
| `onPortPointerDown/Up` | `(e?, nodeId, moduleId?, port) => void` | Edge connection events |
| `onAddModule` | `(serviceId, label) => void` | Called after prompt() returns a name |
