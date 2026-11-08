# Courses & Lessons

This is the core feature. A student picks a course, walks through its lessons in order, reads each lesson's theory and marks it done, which unlocks the next lesson. The platform is theory-only: there is no code execution, build lesson, or node placement.

Three Postgres tables (`courses`, `lessons`, `tags`), two progress tables, and one Mongo collection (`lesson_blocks`) are involved.

## End-to-end flow

```
/courses                                  /courses/:courseId
─────────                                 ──────────────────
Courses.tsx                               CoursePage.tsx
  GET /api/v1/courses/                      GET /api/v1/lessons/course/{id}
  → Course[]                                GET /api/v1/progress/courses/{id}
                                            on open lesson:      PATCH  /progress/courses/{id}  (activeLessonId)
                                            on "mark done":      POST   /progress/courses/{id}/lessons/{lessonId}/complete
                                            on reset:            DELETE /progress/courses/{id}
```

## Frontend

### Listing page — `frontend/src/pages/Courses/`

| File | Lines | Role |
|---|---|---|
| `Courses.tsx` | 27-81 | Fetches featured/recommended/learning-path, manages modal state for a clicked card. |
| `CoursesHeader.tsx` | 13-59 | AI tutor query bar (prompt + suggestion chips). On submit, posts the query (to CopilotKit context, not to a service). |
| `CoursesFilterBar.tsx` | 9-28 | Single-active-filter chip row. Source: `courses.constants.FILTER_CATEGORIES`. |
| `courses.constants.ts` | 1-17 | `FILTER_CATEGORIES`, `AI_SUGGESTIONS`, `NAV_LINKS`. |
| `illustrations.tsx` | — | Maps `course.code` → React SVG component (per-course cover art). |
| `sections/` | — | Section layouts (featured, recommended, learning path). |

Service: `frontend/src/services/courses.ts:76-87`:

| Function | HTTP | Returns |
|---|---|---|
| `getFeaturedCourses()` | `GET /api/v1/courses/` | `Course[]` |
| `getRecommendedCourses()` | (stub) | `[]` — not yet wired. |
| `getLearningPath()` | (stub) | `MOCK_PATH` — hardcoded array. |

### Detail page — `frontend/src/pages/CoursePage/`

The course state machine is split across one orchestrating hook plus pure helper modules (unit-testable without React):

```
CoursePage.tsx                                       (CoursePage.tsx:16-135)
  ├─ getCourseContent(courseId)                      → Lesson[] (services/courseDetail.ts:50)
  ├─ getCourseProgress(courseId)                     → hydrates completed + active lesson
  └─ useCourseState(content, {courseId, initialProgress, unlockAll})   (useCourseState.ts:25-84)
        ├─ courseStateTransitions.ts                 pure state transitions
        │     - initialState()                                        (:10)
        │     - applyOpenLesson(prev, lessons, id, unlockAll)         (:16) lock check, opens theory
        │     - applyMarkTheoryDone(prev, lessons)                    (:32) complete + advance to next
        ├─ courseProgress.ts                         pure derivations
        │     - isLessonUnlocked(lessons, idx, completed)             (:3)
        │     - computeRevealed(lessons, completed)                   (:14)
        └─ useProgressSync.ts                        fire-and-forget BE sync (:8-31)
              - syncActive / syncComplete / syncReset
```

Unit tests: `courseProgress.test.ts`, `courseStateTransitions.test.ts`.

**Admin lesson unlock.** When the `admin-view-locked-lessons` feature flag is on for the user (targeted at the `admin` role), `CoursePage` passes `unlockAll: true` into `useCourseState`. That makes `isUnlocked` return true for every lesson (no lock icons, all clickable) and lets `applyOpenLesson` open an otherwise-locked lesson. Non-admins are unaffected. See [features/feature-flags.md](./feature-flags.md).

State shape (`courseStateTransitions.ts:4-8`):

```ts
type CourseState = {
  completed: Set<lessonId>;
  activeId: lessonId | null;
  theoryOpen: boolean;
};
```

### Services

| File | Function | HTTP | Returns |
|---|---|---|---|
| `services/courses.ts:76-87` | `getFeaturedCourses` | `GET /api/v1/courses/` | `Course[]` |
| `services/courseDetail.ts:50-58` | `getCourseContent(courseId)` | `GET /api/v1/lessons/course/{courseId}` | `CourseContent` (lessons sorted by `order`, mapped from BE shape; `nodes`/`edges` are empty) |
| `services/progress.ts:14-45` | `getCourseProgress`, `enrollInCourse`, `updateProgress`, `completeLesson`, `resetProgress` | `/api/v1/progress/courses/…` | `CourseProgress` |

### Organisms used by CoursePage

| Component | Role |
|---|---|
| `LessonsPanel` | Left sidebar list with lock icons + progress bar (`LessonsPanel.tsx:20`). |
| `CourseBoard` | Main area (`CourseBoard.tsx:13-94`): theory/design tab toggle, design canvas, hosts `TheoryPanel`. |
| `TheoryPanel` | Slide-in overlay for lessons (renders lesson theory HTML). |

`LearningPath`, `CanvasBoard`, and `DiagramArea` also exist under `organisms/` but are not used by `CoursePage`.

## Backend

### Controllers

All under `/api/v1`. Routes by file:

#### `course_controller.py:13-120`

| Method | Path | Body | Returns | Auth |
|---|---|---|---|---|
| GET | `/courses/` | — | `CourseResponse[]` | none |
| GET | `/courses/{course_id}` | — | `CourseResponse` | none |
| POST | `/courses/` | `CourseCreate` | `CourseResponse` | admin |
| PATCH | `/courses/{course_id}` | `CourseUpdate` | `CourseResponse` | admin |
| DELETE | `/courses/{course_id}` | — | 204 | admin |

#### `lesson_controller.py:12-149`

| Method | Path | Returns |
|---|---|---|
| GET | `/lessons/` | `LessonResponse[]` |
| GET | `/lessons/course/{course_id}` | `LessonResponse[]` — what the FE actually uses |
| GET | `/lessons/{lesson_id}` | `LessonResponse` |
| POST | `/lessons/` | `LessonResponse` + auto-creates a `lesson_blocks` doc in Mongo |
| PATCH | `/lessons/{lesson_id}` | `LessonResponse` |
| DELETE | `/lessons/{lesson_id}` | 204 |

#### `lesson_block_controller.py:17-122`

CRUD for the markdown content (`lesson_blocks` documents) behind each lesson.

#### `progress_controller.py:23-153`

| Method | Path | Notes |
|---|---|---|
| GET | `/progress/courses/{course_id}` | Current user's progress (404 if not enrolled) |
| POST | `/progress/courses/{course_id}/enroll` | |
| PATCH | `/progress/courses/{course_id}` | `activeLessonId` (the body still accepts the vestigial `placedNodeIds`, unused by the frontend) |
| POST | `/progress/courses/{course_id}/lessons/{lesson_id}/complete` | |
| DELETE | `/progress/courses/{course_id}` | Reset |

### Services & repositories

| Service | File | Repository |
|---|---|---|
| `CourseService` | `services/course_service.py:6-53` | `repositories/course_repository.py` (Postgres) |
| `LessonService` | `services/lesson_service.py:8-57` | `repositories/lesson_repository.py:8-52` (Postgres) |
| `LessonBlockService` | `services/lesson_block_service.py:7-38` | `repositories/lesson_block_repository.py:6-25` (Mongo) |
| `ProgressService` | `services/progress_service.py` | `repositories/progress_repository.py` (Postgres) |

### Schemas

| File | Models |
|---|---|
| `schemas/course.py:6-39` | `CourseCreate`, `CourseUpdate`, `CourseResponse` |
| `schemas/lesson.py:8-34` | `LessonCreate`, `LessonUpdate`, `LessonResponse` |
| `schemas/lesson_block.py:6-22` | `LessonBlockCreate`, `LessonBlockUpdate`, `LessonBlockResponse` |
| `schemas/progress.py:6-18` | `CourseProgressResponse`, `ProgressUpdate` |

### Dependencies

`dependencies/course.py:14-24` wires:

```python
get_course_service()        → CourseService(CourseRepository(db))
get_lesson_service()        → LessonService(LessonRepository(db))
get_lesson_block_service()  → LessonBlockService(LessonBlockRepository())   # Mongo, no db arg
```

Similar one-liners in `dependencies/lesson_block.py` and `dependencies/progress.py`.

## The data bridge in practice

```
1. FE asks BE for the lessons of course 42:
   GET /lessons/course/42  →  [{id: 5, name: "Locks 101", nosql_id: "abc-uuid", type: "learn", …}, …]

2. FE shows the lesson's `learning` text as its theory body.
   `lessons.nosql_id` points at the `lesson_blocks` document holding the full content.

3. Student marks the lesson done:
   POST /progress/courses/42/lessons/5/complete  →  next lesson unlocks
```

## Surprises

- **Course / lesson counts are denormalized.** `courses.lesson_count` is bumped explicitly on lesson create (`LessonService.create_lesson`). If a lesson is created outside the service, the count drifts.
- **`getRecommendedCourses` and `getLearningPath` are stubs.** They return mock data today.
- **`lessons.order` is the ordering signal.** The FE sorts by it client-side.
- **Auto-create on lesson POST.** Creating a lesson via the API also inserts a blank `lesson_blocks` document in Mongo so the lesson can be opened immediately.
- **Vestigial build support.** `LessonType` still has `build` and `user_course_progress.placed_node_ids` still exists; neither is used by the frontend.
