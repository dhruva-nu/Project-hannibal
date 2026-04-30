---
name: CourseCard
description: Course card molecule — renders a regular course card (illustration, level badge, stack tags, CTA) or a genUI placeholder card via discriminated union prop
type: file
layer: ui
tags: [molecule, courses, card]
imports:
  - "[[frontend/src/shared/components/atoms/_atoms]]"
---

# `molecules/CourseCard/CourseCard.tsx`

**Used by:** [[frontend/src/pages/Courses/Courses]]

---

## Types — lines 3–28

Two prop shapes controlled by `isGenUi`:

### `RegularCardProps` (default, `isGenUi?: false`)

| Prop | Type | Notes |
|---|---|---|
| `code` | `string` | Displayed as `// course.001` tag at top-left |
| `title` | `string` | Card headline |
| `description` | `string` | Body copy |
| `level` | `DifficultyLevel` | `"beginner"` · `"intermediate"` · `"advanced"` · `"next-step"` |
| `lessons` | `number?` | Optional lesson count in meta row |
| `duration` | `string` | e.g. `"~2.5 hrs"` |
| `buildCount` | `number?` | Formatted with `toLocaleString()` |
| `stack` | `string[]?` | Tech stack tags shown bottom-left |
| `ribbon` | `string?` | Rotated badge top-right (e.g. `"★ favourite"`, `"new!"`) |
| `pin` | `string?` | Handwritten label inside the illustration area |
| `illustration` | `React.ReactNode` | SVG content; caller provides the inline SVG element |

### `GenUiCardProps` (`isGenUi: true`)

| Prop | Type | Notes |
|---|---|---|
| `genUiSymbol` | `string?` | Large symbol (defaults to `"+ ✦"`) |
| `genUiLabel` | `string` | Bold label line |
| `genUiHint` | `string` | Monospace hint text below |

---

## `CourseCard` component — lines 47–87

Guards on `props.isGenUi` to select between layouts:
- **GenUI path** — dashed-border card, centred content: symbol + label + hint
- **Regular path** — full card with tag, optional ribbon, illustration box (130px high, graph-paper bg), title, desc, meta row, CTA row

Level styling via `LEVEL_CLASS` and `LEVEL_LABEL` maps — maps `DifficultyLevel` to a CSS module class and a display string.

**Calls:** nothing (presentational leaf)
