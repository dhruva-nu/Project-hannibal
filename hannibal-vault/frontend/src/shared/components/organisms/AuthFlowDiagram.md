---
name: AuthFlowDiagram
description: Static swimlane diagram showing the login sequence — purely presentational, no props
type: file
layer: ui
tags: [organism, diagram, auth, presentational]
imports:
  - "[[frontend/src/shared/components/molecules/_molecules]]"
---

# `organisms/AuthFlowDiagram/AuthFlowDiagram.tsx`

**Imports:** `BoardChrome` (molecule)

**Used by:** [[frontend/src/pages/Login/Login]]

Purely presentational. Hardcoded HTML swimlane diagram showing the 4-step login sequence (submit → hash verify → ok → set HttpOnly cookie). Uses `BoardChrome` for the "auth-flow.canvas" header. Includes a `tutor.snippet` code card showing `argon2.verify` usage.

No props. Extend via props if the flow needs to be dynamic.
