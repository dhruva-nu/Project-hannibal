---
name: ChatMessage
description: Renders one chat message — user plain text or AI typed segments with optional annotation
type: file
layer: ui
tags: [molecule, chat, message]
imports:
  - "[[frontend/src/shared/components/atoms/_atoms]]"
  - "[[frontend/src/shared/types/types]]"
---

# `molecules/ChatMessage/ChatMessage.tsx`

**Imports:** `Avatar`, `TypingIndicator` (atoms) · [[frontend/src/shared/types/types]] (`ChatMessage`)

**Used by:** [[frontend/src/shared/components/organisms/ChatPanel]]

Renders a single message row. For user messages: shows `Avatar role="user"` + plain `text`. For AI messages with `segments`: renders each segment typed — `text` as-is, `code` in a monospace code span, `underline` with underline styling. An optional `annotation` renders as a faint line below. If `isTyping=true`, shows `TypingIndicator` instead of content.
