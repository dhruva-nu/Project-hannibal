# Project Hannibal — Feature Map

Every feature has its own hub note. Each file/service/controller/repository is a **separate node** — open Graph View to see how they connect.

**Graph colours:** 🟠 feature hubs · 🔵 frontend nodes · 🟢 backend nodes

---

## Features

| Feature | FE Route | BE Prefix | Hub |
|---------|----------|-----------|-----|
| Auth | `/login` | `/api/v1/auth` | [[features/auth]] |
| Courses | `/courses` | `/api/v1/courses` | [[features/courses]] |
| Lessons | `/course` | `/api/v1/lessons` | [[features/lessons]] |
| Tags | — | `/api/v1/tags` | [[features/tags]] |
| RCE | `/course` (code runner) | `/api/v1/rce` | [[features/rce]] |
| CopilotKit | global popup | `/api/v1/copilotkit` | [[features/copilotkit]] |
| Health | — | `/api/v1/health` | [[features/health]] |

---

## All nodes

### Frontend
[[Login]] · [[AuthContext]] · [[api]] · [[Courses]] · [[courses-service]] · [[CoursePage]] · [[useCourseState]] · [[courseDetail-service]] · [[nodes-service]]

### Backend — Controllers
[[auth-controller]] · [[course-controller]] · [[lesson-controller]] · [[tags-controller]] · [[rce-controller]] · [[copilotkit-controller]] · [[health-controller]] · [[node-controller]]

### Backend — Services
[[AuthService]] · [[CourseService]] · [[LessonService]] · [[TagsService]] · [[rce-service]] · [[HealthService]] · [[NodeService]]

### Backend — Repositories
[[UserRepository]] · [[RefreshTokenRepository]] · [[CourseRepository]] · [[LessonRepository]] · [[TagsRepository]] · [[HealthRepository]] · [[NodeRepository]]

---

## Layer rules

```
Frontend                              Backend
──────────────────────────────────    ────────────────────────────────────────────
pages                                 controller  (routes, HTTP, cookies)
  └─ organisms / molecules / atoms      └─ service   (business logic, validation)
       └─ services/api.ts (apiFetch)         └─ repository (SQL queries)
            └─ HttpOnly cookie                    └─ model (SQLAlchemy ORM)
```

Never skip layers. Pages call `services/api.ts`; never raw `fetch()`. Controllers call services; services call repositories.

---

## Better documentation tip — use Canvas

Each feature also has an **Obsidian Canvas** (`.canvas`) file that shows the flow as a visual swimlane diagram with real arrows. Open them from the file explorer:

- `features/auth-flow.canvas`
- `features/courses-flow.canvas`
- `features/lessons-flow.canvas`
- `features/rce-flow.canvas`
- `features/copilotkit-flow.canvas`
