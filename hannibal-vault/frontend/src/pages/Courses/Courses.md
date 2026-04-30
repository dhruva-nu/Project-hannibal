---
name: Courses.tsx
description: Courses page — browse, filter, and AI-curate courses; shows a learning path, featured card grid, and an AI-recommended section
type: file
layer: pages
tags: [page, courses, genui]
imports:
  - "[[frontend/src/context/AuthContext]]"
  - "[[frontend/src/hooks/useTheme]]"
  - "[[frontend/src/shared/components/atoms/_atoms]]"
  - "[[frontend/src/shared/components/molecules/CourseCard]]"
  - "[[frontend/src/shared/components/organisms/LearningPath]]"
  - "[[frontend/src/shared/components/organisms/Navbar]]"
---

# `src/pages/Courses/Courses.tsx`

The courses catalogue page. Three sections of content, an AI prompt bar for natural-language course discovery, and a filter chip row for category browsing.

**Imports:** [[frontend/src/context/AuthContext]] · [[frontend/src/hooks/useTheme]] · `PaperBg`, `Badge`, `Input` (atoms) · [[frontend/src/shared/components/molecules/CourseCard]] · [[frontend/src/shared/components/organisms/LearningPath]] · [[frontend/src/shared/components/organisms/Navbar]]

**Route:** `/courses` (protected — requires auth, see [[frontend/src/App]])

---

## `Courses` component — lines 176–274

Two hooks drive the page:
1. `useAuth()` — gets `logout` → passed to Navbar's `onLogout`
2. `useTheme()` — gets `theme` + `toggleTheme` → passed to Navbar

Local state:
- `activeFilter` (`string`) — which filter chip is selected; defaults to `"All"`
- `aiQuery` (`string`) — controlled value for the AI prompt bar input
- `submitted` (`boolean`) — swaps suggestion chips for a "curating…" response line after Enter

### Layout

```
PaperBg (fixed background)
div.stage
  Navbar (links: Courses, Tracks, For teams, Sign in)
  header.pageHeader                       ← two-column grid
    div.headerLeft
      Badge (eyebrow: "/courses · genUI")
      h1 (with .marker highlight + .scribble caveat line)
      p.lede
    div.aiBar                             ← AI prompt surface
      Input (promptMark="$", suffix=sendBtn)
      div.aiSuggestions | p.aiResponse
  div.filterBar                           ← category chips
  main
    section "Continue your build"         ← LearningPath organism
    section "Featured builds"             ← 3-col CourseCard grid (5 cards + 1 genUI slot)
    section "What to learn next"          ← genuiBanner + 3-col CourseCard grid (3 cards + 1 genUI slot)
```

### Static data (defined at module scope)

| Constant | Type | Purpose |
|---|---|---|
| `FILTER_CATEGORIES` | `readonly string[]` | 6 category labels for the filter bar |
| `PATH_STEPS` | `PathStep[]` | 6 steps for the learning path; steps 1–2 `complete`, step 3 `current` |
| `*_SVG` | `JSX.Element` | Inline SVG illustrations for each CourseCard (OTP, OAuth, rate-limit, job queue, webhook, 2FA, mesh-auth, cache) |
| `FEATURED_CARDS` | `CourseCardProps[]` | 5 regular course cards for the Featured section |
| `RECOMMENDED_CARDS` | `CourseCardProps[]` | 3 AI-recommended cards for the What to learn next section |
| `AI_SUGGESTIONS` | `string[]` | 3 pre-filled suggestion chips in the AI bar |
| `NAV_LINKS` | `NavLink[]` | Navbar links with Courses marked active |

**Calls:** [[frontend/src/context/AuthContext#useAuth]] · [[frontend/src/hooks/useTheme#useTheme]] · [[frontend/src/shared/components/organisms/Navbar]] · [[frontend/src/shared/components/organisms/LearningPath]] · [[frontend/src/shared/components/molecules/CourseCard]]
