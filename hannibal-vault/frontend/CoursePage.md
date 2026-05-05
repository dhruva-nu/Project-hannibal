# CoursePage

**File:** `frontend/src/pages/CoursePage/CoursePage.tsx`  
**Route:** `/course`

Interactive course board. Loads course content, tracks lesson completion, renders a canvas-style node graph of the curriculum, and embeds the code runner.

## Functions

| Function | Lines | Notes |
|----------|-------|-------|
| `CoursePage` (component) | 16–90 | Loads content on mount, owns progress display |
| `handleReset` | 31–33 | Confirms then calls `resetAll()` from `useCourseState` |
| `handleExport` | 35–46 | Serialises progress to JSON blob download |

## Calls

→ [[courseDetail-service]] (`getCourseContent`)  
→ [[useCourseState]] (state machine)  
→ [[api]] (via code runner: `api.post /api/v1/rce/execute`)

## Data flow

```
mount
  └─► getCourseContent("otp-system")
        └─► [[courseDetail-service]]   (mock → BE when ready)
              returns { nodes, edges, lessons }
  └─► useCourseState(content) → { state, openLesson, isUnlocked, ... }

user runs code
  └─► api.post /api/v1/rce/execute
        └─► [[rce-controller]].execute_code
              └─► [[rce-service]].run_code   (Docker container)
```
