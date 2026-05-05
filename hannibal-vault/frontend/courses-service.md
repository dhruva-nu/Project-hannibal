# courses-service

**File:** `frontend/src/services/courses.ts`

Data access layer for the courses catalogue. **Currently mocked** — each function has the real `api.get(...)` call commented in above the mock block. Swap the comment when the BE endpoint is confirmed stable.

## Exports

| Export | Returns | Status |
|--------|---------|--------|
| `getFeaturedCourses()` | `Promise<Course[]>` | Mock — swap to `api.get("/api/v1/courses?featured=true")` |
| `getRecommendedCourses()` | `Promise<Course[]>` | Mock |
| `getLearningPath()` | `Promise<LearningPathStep[]>` | Mock |
| `Course` | type | Course shape used by FE |
| `LearningPathStep` | type | Step shape for learning path strip |

## Calls

→ [[api]] *(once mocks are removed)*

## Called by

← [[Courses]]
