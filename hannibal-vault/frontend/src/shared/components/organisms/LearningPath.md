---
name: LearningPath
description: Learning path organism — horizontal scrollable lane of ordered steps with complete/current/upcoming status states and an optional sticky note
type: file
layer: ui
tags: [organism, courses, learning-path]
imports:
  - "[[frontend/src/shared/components/atoms/_atoms]]"
---

# `organisms/LearningPath/LearningPath.tsx`

**Used by:** [[frontend/src/pages/Courses/Courses]]

---

## Types — lines 3–13

```ts
type PathStepStatus = "complete" | "current" | "upcoming";

interface PathStep {
  num: string;    // e.g. "STEP 01"
  title: string;
  meta: string;   // e.g. "argon2id · 12 min"
  status?: PathStepStatus;  // defaults to "upcoming" if omitted
}
```

### `LearningPathProps`

| Prop | Type | Notes |
|---|---|---|
| `steps` | `PathStep[]` | Ordered list of path steps |
| `stickyNote` | `string?` | If provided, renders a rotated sticky note anchored top-right of the path container |

---

## `LearningPath` component — lines 15–37

Outer container (`div.path`) has `overflow-x: auto` so the lane scrolls horizontally on narrow viewports without clipping steps.

Optional sticky note rendered as `div.stickyNote` (absolute-positioned, rotated 4°, uses `--sticky` + `--font-hand` tokens). Marked `aria-hidden`.

Each step renders as `div.step` with three modifier classes applied conditionally:
- `.complete` — green border + box-shadow (`--accent-4`), appends `" ✓"` to the step number via CSS `::after`
- `.current` — coral box-shadow (`--accent-2`), shows `"you are here"` label via CSS `::before` positioned above the card
- (no modifier) — default ink border and shadow

Arrow connectors between steps are pure CSS (`::after` pseudo-element with `border-top: dashed`); the last step's connector is hidden via `.step:last-child::after { display: none }`.

**Calls:** nothing (presentational leaf)
