# Courses & Lessons

This is the core feature. A student picks a course, walks through its lessons in order, and for each `build` lesson they: read instructions, write code, run tests, then place the resulting component on a visual canvas. For `learn` lessons they read theory and acknowledge it.

Three Postgres tables (`courses`, `lessons`, `tags`) and three Mongo collections (`lesson_blocks`, `build_blocks`, `nodes`) are involved.

## End-to-end flow

```
/courses                                  /courses/:courseId
─────────                                 ──────────────────
Courses.tsx                               CoursePage.tsx
  GET /api/v1/courses/                      GET /api/v1/lessons/course/{id}
  → Course[]                                → Lesson[]
                                            for each build lesson on open:
                                              GET /api/v1/build-blocks/{nosql_id}
                                              GET /api/v1/build-blocks/{nosql_id}/translate?language=…
                                              POST /api/v1/run-code/run-simple   (tests)
                                            on "place on board":
                                              GET /api/v1/nodes/{obj_id}/placement
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

This is the heaviest part of the FE. The course state machine is split across one orchestrating hook plus pure helper modules (so the logic is unit-testable without React):

```
CoursePage.tsx                                       (CoursePage.tsx:16-165)
  ├─ getCourseContent(courseId)                      → returns Lesson[]
  └─ useCourseState(content, {courseId, initialProgress})   (useCourseState.ts:29-185)
        ├─ courseStateTransitions.ts                 pure state transitions
        │     - initialState()
        │     - applyOpenLesson(prev, lessons, id)   lock check + theory/build open
        │     - applyMarkTheoryDone(prev, lessons)   complete + advance to next
        │     - applyPlaceOnBoard(prev, lessons, newNodes)  complete + merge placed nodes
        ├─ courseProgress.ts                         pure derivations
        │     - isLessonUnlocked(lessons, idx, completed)
        │     - computeRevealed(lessons, completed, pendingPlacement)
        │     - parseTestOutput / buildTestResults / extractRunError
        └─ useProgressSync.ts                        fire-and-forget BE sync
              - syncActive / syncComplete / syncPlacedNodes / syncReset
```

Unit tests: `courseProgress.test.ts`, `courseStateTransitions.test.ts`.

State shape (`courseStateTransitions.ts:6-18`):

```ts
type CourseState = {
  completed: Set<lessonId>;
  activeId: lessonId | null;
  buildStep: 0 | 1 | 2 | 3;          // closed / reviewing / building / placed
  codeBufs: Record<lessonId, string>;
  testResults: Record<lessonId, TestResult[]>;
  pendingPlacement: PendingPlacement | null;
  theoryOpen: boolean;
  streamOutput: string[];
  isStreaming: boolean;
  runError: string | null;
  placedNodes: PlacedNode[];
};
```

Placement helpers (`placement.ts:6-94`):

| Function | Purpose |
|---|---|
| `withPlacement(state, node)` | Adds one node; handles nesting (a `module` lands inside its parent `service`). |
| `applyPlacementNodes(state, nodes)` | Batched version: non-modules first, then modules so parents exist. |
| `extractEdges(nodes)` | Derives `PlacedEdge[]` from each node's `linked_node_ids`. |
| `mergeEdges(prev, next)` | Set-union by edge id. |

### Services

| File | Function | HTTP | Returns |
|---|---|---|---|
| `services/courses.ts:76-87` | `getFeaturedCourses` | `GET /api/v1/courses/` | `Course[]` |
| `services/courseDetail.ts:71-95` | `getCourseContent(courseId)` | `GET /api/v1/lessons/course/{courseId}` | `Lesson[]` (mapped from BE shape) |
| `services/courseDetail.ts:71-95` | `getBuildBlock(blockId)` | `GET /api/v1/build-blocks/{blockId}` | `{ tests[], objId, … }` |
| `services/courseDetail.ts:71-95` | `translateBuildBlock(blockId, language)` | `GET /api/v1/build-blocks/{blockId}/translate?language=X` | `{ code }` |
| `services/nodes.ts:48-51` | `getNodePlacement(nodeId)` | `GET /api/v1/nodes/{nodeId}/placement` | `NodePlacement` |
| `services/rce.ts` | `runSimple`, `streamExecute` | see [code execution](./code-execution.md) | — |

### Organisms used by CoursePage

| Component | Role |
|---|---|
| `LessonsPanel` | Left sidebar list with lock icons + progress bar. |
| `LearningPath` | Vertical timeline showing complete/current/upcoming. |
| `CourseBoard` | The main canvas: revealed nodes, edges, celebration on completion. |
| `TheoryPanel` | Slide-in overlay for `learn` lessons (renders `LessonBlock.content` HTML). |
| `BuildPanel` | Code editor + test results + output stream for `build` lessons. |
| `CanvasBoard` | Chrome wrapper (header, grid background) around the canvas. |
| `DiagramArea` | SVG container that draws nodes + cubic edges via [`edgePath.ts`](../reference/frontend-shared.md#edgepath). |

## Backend

### Controllers

All under `/api/v1`. Routes by file:

#### `course_controller.py:14-123`

| Method | Path | Body | Returns | Auth |
|---|---|---|---|---|
| GET | `/courses/` | — | `CourseResponse[]` | none |
| GET | `/courses/{course_id}` | — | `CourseResponse` | none |
| POST | `/courses/` | `CourseCreate` | `CourseResponse` | admin |
| PATCH | `/courses/{course_id}` | `CourseUpdate` | `CourseResponse` | admin |
| DELETE | `/courses/{course_id}` | — | 204 | admin |

#### `lesson_controller.py:14-156`

| Method | Path | Returns |
|---|---|---|
| GET | `/lessons/` | `LessonResponse[]` |
| GET | `/lessons/course/{course_id}` | `LessonResponse[]` — what the FE actually uses |
| GET | `/lessons/{lesson_id}` | `LessonResponse` |
| POST | `/lessons/` | `LessonResponse` + auto-creates a `lesson_blocks` doc in Mongo |
| PATCH | `/lessons/{lesson_id}` | `LessonResponse` |
| DELETE | `/lessons/{lesson_id}` | 204 |

#### `node_controller.py:13-31`

| Method | Path | Returns |
|---|---|---|
| GET | `/nodes/{node_id}/placement` | `NodePlacementResponse` — BFS from the given node id through `parent_id` + `linked_node_ids` |

#### `build_block_controller.py:20-159`

| Method | Path | Notes |
|---|---|---|
| GET | `/build-blocks/` | List all |
| GET | `/build-blocks/{block_id}` | UUID-keyed |
| POST | `/build-blocks/` | — |
| PATCH | `/build-blocks/{block_id}` | — |
| GET | `/build-blocks/{block_id}/translate?language=X` | Calls `DslService.translate()` → returns `{ code }` (the template rendered for the target language). |
| DELETE | `/build-blocks/{block_id}` | — |

#### `lesson_block_controller.py:18-124`

Same CRUD shape as build blocks, but for the markdown content used by `learn` lessons.

#### `block_controller.py:20-92`

Unified read endpoint that lists both lesson and build blocks together as a discriminated union (`schemas/block.py:7-28`). Used by admin tooling.

### Services & repositories

| Service | File | Repository |
|---|---|---|
| `CourseService` | `services/course_service.py:10-53` | `repositories/course_repository.py:10-52` (Postgres) |
| `LessonService` | `services/lesson_service.py:12-57` | `repositories/lesson_repository.py:12-52` (Postgres) |
| `NodeService` | `services/node_service.py:10-46` | `repositories/node_repository.py:5-9` (Mongo) |
| `BuildBlockService` | `services/build_block_service.py:11-53` | `repositories/build_block_repository.py:7-40` (Mongo) |
| `LessonBlockService` | `services/lesson_block_service.py:11-38` | `repositories/lesson_block_repository.py:7-25` (Mongo) |
| `DslService` | `services/dsl_service.py` | — (HTTP to the dsl-service container) |

`NodeService.get_placement` does the BFS — it walks `parent_id` (for module nesting) and `linked_node_ids` (for edges), collecting reachable nodes, then returns them as an ordered list the FE can render.

### Schemas

| File | Models |
|---|---|
| `schemas/course.py:6-39` | `CourseCreate`, `CourseUpdate`, `CourseResponse` |
| `schemas/lesson.py:8-34` | `LessonCreate`, `LessonUpdate`, `LessonResponse` |
| `schemas/node.py:6-22` | `NodeType` literal, `NodeResponse`, `NodePlacementResponse` |
| `schemas/build_block.py:6-40` | `BuildBlockCreate`, `BuildBlockUpdate`, `TestCaseResponse`, `BuildBlockResponse` |
| `schemas/lesson_block.py:6-22` | `LessonBlockCreate`, `LessonBlockUpdate`, `LessonBlockResponse` |
| `schemas/block.py:7-28` | Discriminated union `LessonBlockItem | BuildBlockItem` |

### Dependencies

`dependencies/course.py:13-22` wires:

```python
get_course_service()        → CourseService(CourseRepository(db))
get_lesson_service()        → LessonService(LessonRepository(db))
get_lesson_block_service()  → LessonBlockService(LessonBlockRepository())   # Mongo, no db arg
```

Similar one-liners in `dependencies/node.py`, `dependencies/build_block.py`, `dependencies/lesson_block.py`.

## The data bridge in practice

```
1. FE asks BE for the lessons of course 42:
   GET /lessons/course/42  →  [{id: 5, name: "Locks 101", nosql_id: "abc-uuid", type: "build", …}, …]

2. FE opens lesson 5. type === "build" → it asks for the build block:
   GET /build-blocks/abc-uuid
   →  { instructions, code_template, tests: [...], obj_id: "node-root-uuid", … }

3. FE asks the DSL service to render the template for the student's language:
   GET /build-blocks/abc-uuid/translate?language=python  →  { code: "..." }

4. Student writes code, hits Run. FE calls:
   POST /run-code/run-simple  with { code, language, block_id: "abc-uuid" }
   → BE injects code into test_code, sandboxes in Docker, returns {stdout, exit_code, ...}

5. Tests pass. Student clicks "Place on board". FE calls:
   GET /nodes/node-root-uuid/placement  →  list of nodes + edges to render
```

## Surprises

- **Course / lesson counts are denormalized.** `courses.lesson_count` is bumped explicitly on lesson create (`LessonService.create_lesson`). If a lesson is created outside the service, the count drifts.
- **Placement is not persisted.** When a student drags a node around the canvas, the new `x`/`y` lives only in FE state. Reload the page and nodes go back to their `default_x`/`default_y` from Mongo. This is intentional — the canvas is a teaching tool, not a saved diagram.
- **`getRecommendedCourses` and `getLearningPath` are stubs.** They return mock data today. Real implementations should call BE endpoints that don't exist yet.
- **`lessons.order` is the ordering signal.** The FE sorts by it client-side. Tied orders fall back to id.
- **Auto-create on lesson POST.** Creating a lesson via the API also inserts a blank `lesson_blocks` document in Mongo so the lesson can be opened immediately. For build lessons, the corresponding `build_blocks` must be created separately.
