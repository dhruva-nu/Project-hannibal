---
name: PortDot
description: Hoverable connection port dot on a canvas node — appears on parent hover, used to start/finish edge connections
type: file
layer: ui
tags: [atom, diagram, port, connection]
---

# `atoms/PortDot/PortDot.tsx`

**Exports:** `PortDot`, `PortPosition` (`"l" | "r" | "t" | "b"`)

**Used by:** [[frontend/src/shared/components/molecules/BoardNode]] · [[frontend/src/shared/components/molecules/ServiceBlock]]

---

Absolutely positioned dot that sits at one of four positions on a parent element's edges. Hidden by default (`opacity: 0`); the **parent's** CSS module reveals it via `[data-port-dot]` attribute selector on hover:

```css
/* In parent .module.css */
.node:hover [data-port-dot],
.selected [data-port-dot] { opacity: 1; }
```

This avoids cross-component class coupling — the attribute is unscoped by CSS Modules.

## Props

| Prop | Type | Purpose |
|---|---|---|
| `position` | `PortPosition` | Which edge the dot sits on (`l`=left, `r`=right, `t`=top, `b`=bottom) |
| `onPointerDown` | `(e) => void` | Called when user starts dragging from this port to begin an edge |
| `onPointerUp` | `(e) => void` | Called when user releases over this port to finish an edge |

Rendered with `aria-hidden="true"` (decorative; keyboard users interact via the node, not individual ports).
