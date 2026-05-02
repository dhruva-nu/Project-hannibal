---
name: DesignPalette
description: Left sidebar of the DesignBoard — renders labelled groups of draggable PaletteItems from a sections config
type: file
layer: ui
tags: [organism, diagram, palette]
imports:
  - "[[frontend/src/shared/components/molecules/PaletteItem]]"
  - "[[frontend/src/pages/DesignBoard/boardTypes]]"
---

# `organisms/DesignPalette/DesignPalette.tsx`

**Imports:** `PaletteItem` (molecule) · `PaletteSection` from [[frontend/src/pages/DesignBoard/boardTypes]]

**Used by:** [[frontend/src/pages/DesignBoard/DesignBoard]]

---

Stateless sidebar. Iterates over `sections` and renders a monospace `//`-prefixed heading, a group of `PaletteItem` rows, and an optional Caveat-font tip below each group.

The sections config is defined in the page and passed as a prop:

```typescript
// DesignBoard.tsx
const PALETTE_SECTIONS: PaletteSection[] = [
  { title: "Components", items: [...] },
  { title: "Services",   items: [...], tip: "drag onto the board ↘" },
  { title: "Modules",    items: [...], tip: "drop modules INSIDE a service" },
];
```

## Props

| Prop | Type | Purpose |
|---|---|---|
| `sections` | `PaletteSection[]` | Ordered list of titled groups to render |

Each `PaletteSection` has `title`, `items: PaletteEntry[]`, and optional `tip`.
