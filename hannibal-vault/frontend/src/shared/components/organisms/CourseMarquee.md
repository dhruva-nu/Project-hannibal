---
name: CourseMarquee
description: Scrolling course chip ticker — CSS animation loop of course names as coloured chips
type: file
layer: ui
tags: [organism, marquee, animation, presentational]
imports:
  - "[[frontend/src/shared/components/atoms/_atoms]]"
  - "[[frontend/src/shared/types/types]]"
---

# `organisms/CourseMarquee/CourseMarquee.tsx`

**Imports:** `Chip` (atom) · [[frontend/src/shared/types/types]] (`CourseChip`)

**Used by:** [[frontend/src/pages/Home/HeroRight]]

Renders a horizontally scrolling ticker of course names. Duplicates the `courses` array so the CSS animation loop is seamless (`[...courses, ...courses]`). Speed is configurable via the `speed` prop (seconds, default 32). `aria-hidden` since it's decorative.
