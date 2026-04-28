---
name: molecules (folder)
description: Composed UI patterns — two or more atoms assembled into a reusable UI unit
type: folder
layer: ui
tags: [folder, molecules, components]
---

# `src/shared/components/molecules/`

Molecules compose atoms into reusable patterns. They may have minimal local state (e.g. password visibility toggle) but no data fetching.

**Used by:** [[frontend/src/shared/components/organisms/_organisms]] · [[frontend/src/pages/Login/Login]] · [[frontend/src/pages/Home/HeroLeft]]

## Components

| Component | What it does | Atoms used |
|---|---|---|
| `BoardChrome` | Tab bar + meta label header for the canvas shell | — |
| `ChatMessage` | Renders one chat message — plain text (user) or typed segments (AI) with annotation | `Avatar`, `TypingIndicator` |
| `DiagramNode` | A draggable canvas node with label, icon, sub-label, and optional tag badge | — |
| `InputField` | Labelled text/email input with a `$` prompt mark | `Input` |
| `NavBrand` | Logo + "Hannibal" wordmark link | `BrandMark` |
| `OAuthButton` | OAuth provider button (Google / GitHub) with provider icon | — |
| `PasswordField` | Password input with show/hide toggle and optional hint link | `Input` |
| `StepCard` | Numbered process step with title, description, and optional arrow | — |
| `Tabs` | Segmented control — renders a list of `TabItem` and calls `onChange` on click | — |
| `TrustPill` | Single trust badge (e.g. "SSO ready") | — |
| `TrustPillStrip` | Row of `TrustPill` items | `TrustPill` |

### Key connections

- [[frontend/src/shared/components/molecules/ChatMessage]] is used by [[frontend/src/shared/components/organisms/ChatPanel]]
- [[frontend/src/shared/components/molecules/DiagramNode]] is used by [[frontend/src/shared/components/organisms/DiagramArea]]
- [[frontend/src/shared/components/molecules/BoardChrome]] is used by [[frontend/src/shared/components/organisms/CanvasBoard]] and [[frontend/src/shared/components/organisms/AuthFlowDiagram]]
- [[frontend/src/shared/components/molecules/InputField]] and [[frontend/src/shared/components/molecules/PasswordField]] are used by [[frontend/src/shared/components/organisms/LoginForm]]
- [[frontend/src/shared/components/molecules/OAuthButton]] is used by [[frontend/src/shared/components/organisms/LoginForm]]
- [[frontend/src/shared/components/molecules/NavBrand]] is used by [[frontend/src/shared/components/organisms/Navbar]] and [[frontend/src/pages/Login/Login]]
- [[frontend/src/shared/components/molecules/Tabs]] is used by [[frontend/src/pages/Login/Login]]
- [[frontend/src/shared/components/molecules/StepCard]] is used by [[frontend/src/shared/components/organisms/HowItWorksStrip]]
