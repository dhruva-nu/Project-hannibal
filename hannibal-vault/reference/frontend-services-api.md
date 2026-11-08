# Frontend Services & API Client

The only place in the frontend that talks HTTP. Pages and hooks import from `services/*`; components never do.

## `services/api.ts` — the one fetch wrapper

```ts
api.get<T>(path)
api.post<T>(path, body)
api.put<T>(path, body)
api.patch<T>(path, body)
api.delete<T>(path)
```

All of the above call a private `apiFetch(path, init)` that:

1. Prepends `/api/v1` is **not** done here — paths are passed in full (`"/api/v1/courses/"`). The `api.ts` file uses the path you give it as-is.
2. Adds `credentials: "include"` on every request so cookies travel.
3. Sets `Content-Type: application/json` for bodied requests.
4. **On 401** (and the path is not in `SKIP_REFRESH`):
   - `POST /api/v1/auth/refresh`
   - If refresh succeeded, retry the original request once.
   - If refresh failed, `window.location.href = "/login"` (skipped when already on `/login`, to avoid a reload loop), then throws `Session expired`.
5. On any other 4xx/5xx, parses `{ detail }` from the JSON body and throws `Error(detail || "Request failed (<status>)")`.
6. Returns `undefined` for `204 No Content`, otherwise parses JSON to `T`.

```ts
const SKIP_REFRESH = ["/api/v1/auth/login", "/api/v1/auth/refresh", "/api/v1/auth/register"];
```

Source: `frontend/src/services/api.ts:1-54`. Unit tests: `frontend/src/services/api.test.ts`.

## Per-feature services

Each service file is a thin module of named async functions. None of them do business logic — they map a function call to an HTTP call + a type assertion.

### `services/courses.ts:76-87`

| Function | HTTP | Returns |
|---|---|---|
| `getFeaturedCourses()` | `GET /api/v1/courses/` | `Course[]` |
| `getRecommendedCourses()` | (stub, returns `[]`) | — |
| `getLearningPath()` | (stub, returns `MOCK_PATH`) | — |

### `services/courseDetail.ts:50-58`

| Function | HTTP | Returns |
|---|---|---|
| `getCourseContent(courseId)` | `GET /api/v1/lessons/course/{courseId}` | `CourseContent` — lessons sorted by `order`, each mapped from BE `LessonResponse` to FE `Lesson` (`nosqlId`, theory body from `learning`). `nodes` / `edges` are empty. |

### `services/progress.ts:14-45`

| Function | HTTP | Returns |
|---|---|---|
| `getCourseProgress(courseId)` | `GET /api/v1/progress/courses/{courseId}` | `CourseProgress \| null` (null on 404) |
| `enrollInCourse(courseId)` | `POST /api/v1/progress/courses/{courseId}/enroll` | `CourseProgress` |
| `updateProgress(courseId, patch)` | `PATCH /api/v1/progress/courses/{courseId}` | `CourseProgress` (`patch` = `{ activeLessonId }`) |
| `completeLesson(courseId, lessonId)` | `POST /api/v1/progress/courses/{courseId}/lessons/{lessonId}/complete` | `CourseProgress` |
| `resetProgress(courseId)` | `DELETE /api/v1/progress/courses/{courseId}` | `void` |

### `services/featureFlags.ts`

Fetches evaluated flags; see [features/feature-flags.md](../features/feature-flags.md).

### `services/auth.ts:1-18`

| Function | HTTP | Returns |
|---|---|---|
| `getCurrentUser()` | `GET /api/v1/auth/me` | `User` |
| `login(email, password)` | `POST /api/v1/auth/login` | `User` |
| `register(email, password)` | `POST /api/v1/auth/register` | `void` |
| `logout()` | `POST /api/v1/auth/logout` | `void` |

## Service usage map

| Page / Hook | Services used |
|---|---|
| `pages/Courses/Courses.tsx` | `courses.ts` |
| `pages/CoursePage/CoursePage.tsx` | `courseDetail.getCourseContent`, `progress.getCourseProgress` |
| `pages/CoursePage/useProgressSync.ts` | `progress.updateProgress`, `progress.completeLesson`, `progress.resetProgress` |
| `pages/Storyboard/Storyboard.tsx` | `courseDetail.getCourseContent` |
| `pages/Login/Login.tsx` | `auth.login`, `auth.register` |
| `context/AuthContext.tsx` | `auth.getCurrentUser`, `auth.logout` |

There is intentionally **no `services/tags.ts`** — tags aren't consumed by the FE yet. Auth goes through `services/auth.ts` like every other feature; nothing outside `services/` calls `fetch`.

## Conventions

- Service files export named functions, never default exports.
- Each function does one HTTP call (no orchestration).
- The function returns the typed body — no envelope shape — and throws on non-2xx via the `api.ts` wrapper.
- Request paths are spelled out in full (`/api/v1/...`) — no shared base-URL constant. Trade-off: easier to grep, more places to update on a path change.
