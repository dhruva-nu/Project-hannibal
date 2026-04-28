---
name: ChatPanel
description: Chat stream panel — renders message history with typing indicator and a prompt-style input row
type: file
layer: ui
tags: [organism, chat, input]
imports:
  - "[[frontend/src/shared/components/molecules/_molecules]]"
  - "[[frontend/src/shared/types/types]]"
---

# `organisms/ChatPanel/ChatPanel.tsx`

**Imports:** `ChatMessage` (molecule) · [[frontend/src/shared/types/types]] (`ChatMessage` type)

**Used by:** [[frontend/src/pages/Home/HeroRight]] · [[frontend/src/pages/Storyboard/Storyboard]]

---

## `ChatPanel` component — lines 20–82

Props: `messages`, `isTyping`, `aiAnnotation`, `placeholder`, `onSubmit`.

Renders a scrollable message stream: each message via `ChatMessage` molecule. If `isTyping=true` and there are messages, appends a typing indicator message at the end.

Input row has a `$` prompt mark, a text input, and a send button. Submits on Enter or button click.

---

## `handleSubmit` — lines 30–36

Trims the input, calls `props.onSubmit(text)`, clears the input, and refocuses. Does nothing if the input is empty.

**Calls:** `props.onSubmit` → [[frontend/src/pages/Home/useAiStream#handleChatSubmit]]
