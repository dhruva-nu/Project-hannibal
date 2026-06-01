# Frontend Services & API Client

The only place in the frontend that talks HTTP. Pages and hooks import from `services/*`; components never do.

## `services/api.ts` — the one fetch wrapper

```ts
api.get<T>(path)
api.post<T>(path, body)
api.put<T>(path, body)
api.delete<T>(path)
```

All of the above call a private `apiFetch(path, init)` that:

1. Prepends `/api/v1` is **not** done here — paths are passed in full (`"/api/v1/courses/"`). The `api.ts` file uses the path you give it as-is.
2. Adds `credentials: "include"` on every request so cookies travel.
3. Sets `Content-Type: application/json` for bodied requests.
4. **On 401** (and the path is not in `SKIP_REFRESH`):
   - `POST /api/v1/auth/refresh`
   - If refresh succeeded, retry the original request once.
   - If refresh failed, `window.location.href = "/login"`.
5. On any other 4xx/5xx, parses `{ detail }` from the JSON body and throws `Error(detail || "Request failed (<status>)")`.
6. Returns `undefined` for `204 No Content`, otherwise parses JSON to `T`.

```ts
const SKIP_REFRESH = ["/api/v1/auth/login", "/api/v1/auth/refresh", "/api/v1/auth/register"];
```

Source: `frontend/src/services/api.ts:1-54`.

## Per-feature services

Each service file is a thin module of named async functions. None of them do business logic — they map a function call to an HTTP call + a type assertion.

### `services/courses.ts:76-87`

| Function | HTTP | Returns |
|---|---|---|
| `getFeaturedCourses()` | `GET /api/v1/courses/` | `Course[]` |
| `getRecommendedCourses()` | (stub, returns `[]`) | — |
| `getLearningPath()` | (stub, returns `MOCK_PATH`) | — |

### `services/courseDetail.ts:71-95`

| Function | HTTP | Returns |
|---|---|---|
| `getCourseContent(courseId)` | `GET /api/v1/lessons/course/{courseId}` | `Lesson[]` — maps BE `LessonResponse` to FE `Lesson` (renames `type` → `kind`, `nosqlId` UUID). |
| `getBuildBlock(blockId)` | `GET /api/v1/build-blocks/{blockId}` | `BuildBlockInfo` — `{ tests: [{name, description}], objId }`. |
| `translateBuildBlock(blockId, language)` | `GET /api/v1/build-blocks/{blockId}/translate?language={language}` | `{ code }` — template rendered for the target language by the DSL service. |

### `services/nodes.ts:48-51`

| Function | HTTP | Returns |
|---|---|---|
| `getNodePlacement(nodeId)` | `GET /api/v1/nodes/{nodeId}/placement` | `NodePlacement{ nodes: NodePlacementEntry[] }` — BFS subgraph rooted at the given node id. |

### `services/rce.ts:20-59`

| Function | HTTP | Returns |
|---|---|---|
| `runSimple(code, language, blockId)` | `POST /api/v1/run-code/run-simple` | `RunSimpleResponse{ exit_code, stdout, stderr, timed_out, duration_ms, block_id }` |
| `streamExecute(code, language, onEvent)` | `POST /api/v1/rce/execute/stream` | `void` — streams SSE; emits `StdoutLine | StderrLine | ExitEvent | ErrorEvent` via `onEvent`. |

## Service usage map

| Page / Hook | Services used |
|---|---|
| `pages/Courses/Courses.tsx` | `courses.ts` |
| `pages/CoursePage/CoursePage.tsx` | `courseDetail.getCourseContent` |
| `pages/CoursePage/useTestExecution.ts` | `courseDetail.getBuildBlock`, `rce.runSimple`, `rce.streamExecute` |
| `pages/CoursePage/useBoardPlacement.ts` | `nodes.getNodePlacement` |
| `pages/Login/Login.tsx` | direct `apiFetch` for `/auth/login` and `/auth/register` |
| `context/AuthContext.tsx` | direct `apiFetch` for `/auth/me`, `/auth/logout` |

There is intentionally **no `services/tags.ts`** and **no `services/auth.ts`**. Tags isn't consumed by the FE yet. Auth uses `apiFetch` directly because there's already a service-like abstraction in `AuthContext`.

## Conventions

- Service files export named functions, never default exports.
- Each function does one HTTP call (no orchestration).
- The function returns the typed body — no envelope shape — and throws on non-2xx via the `api.ts` wrapper.
- Request paths are spelled out in full (`/api/v1/...`) — no shared base-URL constant. Trade-off: easier to grep, more places to update on a path change.
