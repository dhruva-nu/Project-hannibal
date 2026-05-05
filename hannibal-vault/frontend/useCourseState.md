# useCourseState

**File:** `frontend/src/pages/CoursePage/useCourseState.ts`

State machine for a course session. Tracks which lessons are completed, which is active, and which graph nodes are revealed. Pure local state — no API calls.

## Exports

| Export | Purpose |
|--------|---------|
| `useCourseState(content)` | Returns `{ state, openLesson, completeLesson, resetAll, isUnlocked, getRevealed }` |

## Called by

← [[CoursePage]]
