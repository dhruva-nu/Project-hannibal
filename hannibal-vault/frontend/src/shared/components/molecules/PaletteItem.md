---
name: PaletteItem
description: Draggable palette entry that carries kind/label via the HTML Drag-and-Drop API onto the DesignCanvas
type: file
layer: ui
tags: [molecule, diagram, drag-and-drop, palette]
imports:
  - "[[frontend/src/pages/DesignBoard/boardTypes]]"
---

# `molecules/PaletteItem/PaletteItem.tsx`

**Imports:** `PaletteKind` from [[frontend/src/pages/DesignBoard/boardTypes]]

**Used by:** [[frontend/src/shared/components/organisms/DesignPalette]]

---

A single draggable row in the left palette panel. On `dragstart` it writes `kind` (`"component"` | `"service"` | `"module"`) and `label` into `dataTransfer`, which the [[frontend/src/shared/components/organisms/DesignCanvas]] `drop` handler reads.

## Visual variants

| `kind` | Style |
|---|---|
| `component` | Solid blue border (`--accent-3`), icon with tinted fill |
| `module` | Same as component |
| `service` | Dashed border (`--ink-soft`), transparent background — signals "container" semantics |

## Props

| Prop | Type | Purpose |
|---|---|---|
| `kind` | `PaletteKind` | Controls visual style and what type of node is created on drop |
| `label` | `string` | Value written to `dataTransfer` and used as the node label |
| `displayLabel` | `string?` | Override the visible text without changing the drag data |
