---
name: Home.tsx
description: Home page — orchestrates the AI tutor experience with diagram canvas, chat stream, and agent task board
type: file
layer: pages
tags: [page, home, copilotkit, agent]
imports:
  - "[[frontend/src/context/AuthContext]]"
  - "[[frontend/src/hooks/useTheme]]"
  - "[[frontend/src/pages/Home/useAiStream]]"
  - "[[frontend/src/pages/Home/HeroLeft]]"
  - "[[frontend/src/pages/Home/HeroRight]]"
  - "[[frontend/src/shared/components/organisms/Navbar]]"
---

# `src/pages/Home/Home.tsx`

The main page of the app. Orchestrates three data sources and passes their output to child components.

**Imports:** [[frontend/src/context/AuthContext]] · [[frontend/src/hooks/useTheme]] · [[frontend/src/pages/Home/useAiStream]] · [[frontend/src/pages/Home/HeroLeft]] · [[frontend/src/pages/Home/HeroRight]] · [[frontend/src/shared/components/organisms/Navbar]]

---

## `Home` component — lines 15–49

Three hooks drive the page:
1. `useAuth()` — gets `logout` callback → passed to [[frontend/src/shared/components/organisms/Navbar]]
2. `useTheme()` — gets `theme` + `toggleTheme` → passed to Navbar
3. `useAiStream()` — gets `visibleMessages`, `isTyping`, `isStreaming`, `handleChatSubmit` → passed to [[frontend/src/pages/Home/HeroRight]]

Also calls `useCoAgent({ name: "default" })` from CopilotKit to subscribe to the backend agent's state (`agentState.tasks`). When the AI calls `update_tasks`, this re-renders with the new task list, which is passed down to `HeroRight` for display.

Adds `useCopilotReadable` to tell the AI what page the user is on.

Layout: `PaperBg` background → `Navbar` at top → hero split into `HeroLeft` (marketing) + `HeroRight` (interactive canvas).

**Calls:** [[frontend/src/context/AuthContext#useAuth]] · [[frontend/src/hooks/useTheme#useTheme]] · [[frontend/src/pages/Home/useAiStream#useAiStream]] · [[frontend/src/pages/Home/HeroLeft]] · [[frontend/src/pages/Home/HeroRight]] · [[frontend/src/shared/components/organisms/Navbar]]
