# courseDetail-service

**File:** `frontend/src/services/courseDetail.ts`

Fetches the content for a single course board — nodes, edges, and lesson list. **Currently mocked.** The `nosqlId` field on each lesson points to MongoDB content that will back the real implementation.

## Exports

| Export | Returns | Status |
|--------|---------|--------|
| `getCourseContent(courseCode)` | `Promise<CourseContent>` | Mock — will call `api.get("/api/v1/lessons/course/{id}")` |
| `CourseContent` | type | `{ nodes, edges, lessons }` |

## Calls

→ [[api]] *(once mocks are removed)*

## Called by

← [[CoursePage]]
