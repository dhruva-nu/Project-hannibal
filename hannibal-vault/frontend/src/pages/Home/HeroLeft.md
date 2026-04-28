---
name: HeroLeft.tsx
description: Left hero column — headline, CTA buttons, HowItWorksStrip; purely presentational
type: file
layer: pages
tags: [page, home, presentational]
imports:
  - "[[frontend/src/shared/components/atoms/_atoms]]"
  - "[[frontend/src/shared/components/organisms/HowItWorksStrip]]"
---

# `src/pages/Home/HeroLeft.tsx`

Pure presentational component. No state, no hooks. Renders the left half of the hero section: a sticky note, badge, headline, subtitle, two CTA buttons, meta stats, and the HowItWorksStrip.

**Imports:** [[frontend/src/shared/components/atoms/_atoms]] (`Badge`, `Button`, `StickyNote`) · [[frontend/src/shared/components/organisms/HowItWorksStrip]]

**Used by:** [[frontend/src/pages/Home/Home]]
