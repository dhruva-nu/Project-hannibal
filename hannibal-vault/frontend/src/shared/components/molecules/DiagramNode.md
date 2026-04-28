---
name: DiagramNode
description: Draggable canvas node — absolute positioned, supports pointer drag, notifies parent of new position
type: file
layer: ui
tags: [molecule, diagram, draggable]
imports:
  - "[[frontend/src/shared/types/types]]"
---

# `molecules/DiagramNode/DiagramNode.tsx`

**Imports:** [[frontend/src/shared/types/types]] (`DiagramNodeData`)

**Used by:** [[frontend/src/shared/components/organisms/DiagramArea]]

Absolutely positioned node card. Implements pointer-based drag: `onPointerDown` captures the pointer and starts tracking `pointermove` / `pointerup` events to compute delta. Calls `props.onMove(id, newX, newY)` on each drag frame so the parent [[frontend/src/shared/components/organisms/DiagramArea#handleMove]] can update state and trigger edge reflow.

Renders: icon (handwritten font) + label + sub-label + optional `tag` badge (rotated, accented).
