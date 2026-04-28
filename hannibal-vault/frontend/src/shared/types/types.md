---
name: shared/types/index.ts
description: All shared TypeScript types — User, ChatMessage, DiagramNode, Theme, and more
type: file
layer: types
tags: [types, typescript, shared]
---

# `src/shared/types/index.ts`

Single source of truth for all TypeScript types shared across the app. No logic, only type declarations.

**Used by:** nearly every file in the codebase.

---

## Types catalogue

| Type | Purpose |
|---|---|
| `Theme` | `"light" \| "dark"` — for [[frontend/src/hooks/useTheme]] |
| `User` | Auth user: `id`, `email`, `provider`, `oauth_id` |
| `AccentPalette` | Named accent set (highlighter, coral, lime, blueprint) |
| `MessageRole` | `"user" \| "ai"` |
| `ChatSegment` | One typed chunk of an AI message: `type` (text/code/underline), `value`, optional `annotation` |
| `ChatMessage` | One message in the chat: `id`, `role`, optional `text` (user) or `segments` (AI) |
| `DiagramNodeData` | A canvas node: `id`, `label`, `icon`, `sub`, `tag`, position `x/y` |
| `DiagramEdge` | An SVG edge: `from`, `to`, `color`, `dashArray` |
| `CourseChip` | A marquee chip: `name`, `color` |
| `HowStep` | A step in `HowItWorksStrip`: `num`, `title`, `desc`, `hasArrow` |
| `SwimLaneStep` | A row in `AuthFlowDiagram` |
| `NavLink` | `{ label, href }` for Navbar links |
| `TrustItem` | `{ label }` for TrustPillStrip |
| `TabItem` | `{ id, label }` for Tabs |
