---
name: DesignBoard
description: Interactive system design drawing board — drag components/services onto a canvas, draw connections, inspect and edit nodes
type: file
layer: pages
tags: [page, diagram, design-board, drag-and-drop]
imports:
  - "[[frontend/src/pages/DesignBoard/useDesignBoard]]"
  - "[[frontend/src/shared/components/organisms/DesignPalette]]"
  - "[[frontend/src/shared/components/organisms/DesignCanvas]]"
  - "[[frontend/src/shared/components/organisms/DesignInspector]]"
---

# `pages/DesignBoard/DesignBoard.tsx`

**Route:** `/design-board` (protected)

**Imports:**
- [[frontend/src/pages/DesignBoard/useDesignBoard]] — all board state and logic
- [[frontend/src/shared/components/organisms/DesignPalette]] — left panel
- [[frontend/src/shared/components/organisms/DesignCanvas]] — main canvas
- [[frontend/src/shared/components/organisms/DesignInspector]] — right panel

---

## Layout

```
.stage (100vh flex column)
  ├── header .topbar
  │     ├── BrandMark + breadcrumb
  │     └── ThemeToggle · clear · export json · save build
  └── .main  (grid: 200px · 1fr · 240px)
        ├── DesignPalette   (left)
        ├── DesignCanvas    (center, flex: 1)
        └── DesignInspector (right — hidden below 1100px)
```

## State — `useDesignBoard` hook

All board state lives in [[frontend/src/pages/DesignBoard/useDesignBoard]]. The page seeds the canvas on mount via `board.seed()`.

## Files in this folder

- [[frontend/src/pages/DesignBoard/useDesignBoard]] — state hook
- [[frontend/src/pages/DesignBoard/boardTypes]] — shared type definitions
