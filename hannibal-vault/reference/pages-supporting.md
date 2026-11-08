# Supporting Pages

Three pages exist beside the main learning loop: **Home**, **Storyboard**, **DesignBoard**. They don't have a feature doc each — they're either showcases or sandboxes — but you'll see them in routing.

## Home — `frontend/src/pages/Home/`

Landing page once you're signed in. Three columns: Navbar at the top, a hero on the left, an AI chat panel on the right.

| File | Lines | Role |
|---|---|---|
| `Home.tsx` | 11-45 | Page shell. Calls `useCopilotReadable()` twice (page context + user info) so the agent has grounding; calls `useCoAgent()` to mirror agent-side task state into FE state for display. |
| `HeroLeft.tsx` | — | Marketing hero with `CourseMarquee` and `HowItWorksStrip`. |
| `HeroRight.tsx` | — | Live AI chat panel — renders the agent task list and accepts new prompts. |
| `useAiStream.ts` | 24-112 | **Client-side typing simulation.** Animates a hardcoded response character-by-character. No backend or streaming call — this is purely cosmetic. Returns `{ visibleMessages, isTyping, isStreaming, handleChatSubmit }`. |

Backend touched: only CopilotKit (`/api/v1/copilotkit` via the `<CopilotKit>` provider at the App root). No direct API calls from Home itself.

Why a fake stream? The CopilotKit popup handles real agent traffic; the Home hero exists to *show* what the agent feels like before you open the popup. The fake stream is intentional UI polish.

## Storyboard — `frontend/src/pages/Storyboard/`

Internal component library / design preview. Lists every atom, molecule, organism with a labeled section so reviewers can see them side by side.

| File | Lines | Role |
|---|---|---|
| `Storyboard.tsx` | 17-89 | Composes the demo sections. Fetches `getCourseContent(1)` so a real lesson list can be embedded in demos. |
| `StoryboardSidebar.tsx` | — | Quick-jump navigation. |
| `storyboard.data.ts` | — | Hardcoded sample messages, sample course cards, sample chat threads. |
| `sections/` | — | One file per atom/molecule/organism section. |
| `CourseBoardDemo.tsx`, `OrgStory.tsx`, `StoryCard.tsx` | — | Demo wrappers around interactive organisms. |

Backend touched: `GET /api/v1/lessons/course/1` (to seed the demo with a real lesson list). Everything else is hardcoded.

Use this page when you add or change a component — confirm the visual change here before committing.

## DesignBoard — `frontend/src/pages/DesignBoard/`

A free-form system-design sandbox. Drag components, services, and modules from a palette onto a canvas; draw edges between port dots; inspect/edit/delete selected items. Export the result as JSON.

| File | Lines | Role |
|---|---|---|
| `DesignBoard.tsx` | 45-126 | Page shell. Composes `DesignPalette` (left), `DesignCanvas` (center), `DesignInspector` (right). |
| `useDesignBoard.ts` | — | State machine: nodes, edges, selection, pending edge, palette additions. |
| `useBoardEdges.ts` | — | Edge math (anchor resolution via `edgePath`), pending-edge cursor tracking. |
| `boardTypes.ts` | — | Page-local types (`BoardModule`, `BoardNodeData`, `SelectedItem`, etc. — re-exported from `shared/types/board`). |
| `boardSeed.ts` | — | Starter nodes/edges if the user opens an empty board. |

Backend touched: **none.** Everything lives in FE state. The "export JSON" button gives a printable representation; there's no save endpoint yet.

This page is a sketchbook. If a future feature needs saved diagrams, the place to add it is `useDesignBoard.ts` — current state already serializes cleanly.

## Quick reference

| Page | Route | Backend dependency |
|---|---|---|
| Home | `/home` | CopilotKit (Gemini) |
| Storyboard | `/storyboard` | `GET /lessons/course/1` |
| DesignBoard | `/design-board` | none |
