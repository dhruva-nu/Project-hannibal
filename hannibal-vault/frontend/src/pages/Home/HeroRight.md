---
name: HeroRight.tsx
description: Right hero column — CanvasBoard with DiagramArea + ChatPanel, CourseMarquee, and agent task board
type: file
layer: pages
tags: [page, home, agent, canvas]
imports:
  - "[[frontend/src/shared/components/organisms/CanvasBoard]]"
  - "[[frontend/src/shared/components/organisms/DiagramArea]]"
  - "[[frontend/src/shared/components/organisms/ChatPanel]]"
  - "[[frontend/src/shared/components/organisms/CourseMarquee]]"
  - "[[frontend/src/shared/types/types]]"
---

# `src/pages/Home/HeroRight.tsx`

Presentational — all data flows in via props from [[frontend/src/pages/Home/Home]]. Assembles the interactive right half of the hero.

**Imports:** [[frontend/src/shared/components/organisms/CanvasBoard]] · [[frontend/src/shared/components/organisms/DiagramArea]] · [[frontend/src/shared/components/organisms/ChatPanel]] · [[frontend/src/shared/components/organisms/CourseMarquee]] · [[frontend/src/shared/types/types]]

**Used by:** [[frontend/src/pages/Home/Home]]

---

## `HeroRight` component — lines 43–84

Props: `visibleMessages`, `isTyping`, `isStreaming`, `agentTasks`, `onChatSubmit`.

Contains hardcoded `NODES` and `EDGES` for the OTP system demo diagram. These are static — the diagram reacts to dragging but the topology is fixed.

Renders inside `CanvasBoard`:
- `DiagramArea` — the draggable node + SVG arrow diagram
- `ChatPanel` — the streaming chat UI

Below the board: `CourseMarquee` (scrolling chips). If `agentTasks.length > 0`, renders the AI-suggested task list with status badges.
