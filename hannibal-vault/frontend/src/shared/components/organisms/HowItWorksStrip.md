---
name: HowItWorksStrip
description: 3-step horizontal process strip — SELECT → SKETCH → BUILD
type: file
layer: ui
tags: [organism, how-it-works, presentational]
imports:
  - "[[frontend/src/shared/components/molecules/_molecules]]"
  - "[[frontend/src/shared/types/types]]"
---

# `organisms/HowItWorksStrip/HowItWorksStrip.tsx`

**Imports:** `StepCard` (molecule) · [[frontend/src/shared/types/types]] (`HowStep`)

**Used by:** [[frontend/src/pages/Home/HeroLeft]]

Purely presentational. Renders an array of `HowStep` items as a horizontal row of `StepCard` components. Default steps: 01/SELECT, 02/SKETCH, 03/BUILD. Accepts custom `steps` prop to override.
