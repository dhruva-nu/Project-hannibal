---
name: useAiStream.ts
description: Demo chat animation hook — simulates character-by-character AI streaming with typed segments
type: file
layer: pages
tags: [hook, home, animation, chat]
imports:
  - "[[frontend/src/shared/types/types]]"
---

# `src/pages/Home/useAiStream.ts`

A demo animation hook — not connected to the real AI. Simulates the character-by-character streaming effect seen in the hero `ChatPanel`. The real CopilotKit AI runs via `CopilotPopup` in [[frontend/src/App]].

**Imports:** [[frontend/src/shared/types/types]] (`ChatMessage`, `ChatSegment`)

**Used by:** [[frontend/src/pages/Home/Home]]

---

## `useAiStream` — lines 24–112

Manages the demo chat state machine. Returns `{ visibleMessages, isTyping, isStreaming, handleChatSubmit }`.

On mount, delays 900ms then calls `streamAiResponse` to animate the hardcoded `AI_SEGMENTS` reply.

---

## `streamAiResponse` — lines 37–75

Core animation loop. Uses `setTimeout` ticks (speed varies per segment type: `text=18ms`, `code=32ms`, `underline=28ms`) to advance through `AI_SEGMENTS` character by character, updating `streamingMsg` each tick. Calls `onDone` with the completed message when all segments are rendered.

---

## `handleChatSubmit` — lines 90–107

Called when the user submits a message in `ChatPanel`. Cancels any in-flight stream, appends the user message to `messages`, sets `isTyping=true`, then after 900ms starts streaming a new AI response via `streamAiResponse`.
