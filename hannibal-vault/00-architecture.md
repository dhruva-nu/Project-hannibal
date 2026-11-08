# Architecture

Project Hannibal is a three-tier web app: React frontend, FastAPI backend, and Postgres + Mongo data stores.

```
┌────────────────────────────┐      ┌──────────────────────────────────────┐
│   React 19 + Vite (5173)   │◄────►│      FastAPI (8000, /api/v1/*)       │
│   pages → organisms        │      │  controllers → services → repos      │
│   services/api.ts          │      │  + CopilotKit @ /api/v1/copilotkit   │
└────────────┬───────────────┘      └──────────┬────────────────┬──────────┘
             │                                  │                │
             │  HttpOnly cookies                │                │
             │  (access + refresh)              │                │
             ▼                                  ▼                ▼
                                       ┌────────────────┐  ┌──────────────┐
                                       │ PostgreSQL 17  │  │ MongoDB 8    │
                                       │ relational     │  │ documents    │
                                       │ (users,        │  │ (lesson_     │
                                       │  courses,      │  │  blocks,     │
                                       │  lessons,      │  │  user_       │
                                       │  tags, progress│  │  preferences)│
                                       │  refresh_tokens│  │              │
                                       │  feature_flags)│  │              │
                                       └────────────────┘  └──────────────┘
```

## Stack

| Tier | Tech | Notes |
|---|---|---|
| Frontend | React 19, TypeScript, Vite, React Router v6, CSS Modules | `bun` package manager. No state library — local state + Context. |
| Backend | FastAPI, SQLAlchemy 2 (sync), Beanie (async Mongo), Pydantic 2, JWT (python-jose), bcrypt, httpx | `uv` package manager. Python 3.14. |
| DBs | PostgreSQL 17 (pgvector), MongoDB 8 | Postgres holds relational data; Mongo holds blob-shaped content (markdown lesson bodies, user preferences). |
| AI | LangGraph + Gemini 2.5 Flash (`langchain-google-genai`) via CopilotKit | Powers the in-app `CopilotPopup` and the Home-page agent chat. |

## Why two databases?

Postgres is the source of truth for **identity and structure** — who the user is, which courses and lessons exist, how they're ordered, what tag they belong to. Foreign keys matter here.

Mongo is the store for **content** — the long-form markdown body of a lesson and per-user preferences. These are blob-shaped and referenced from Postgres by UUID (`lessons.nosql_id`, `users.preference_id`).

This split is deliberate: relational invariants (a lesson must belong to a course) stay in Postgres; lesson content can change shape freely in Mongo without a migration.

## Request flow (canonical example)

A student opens **Courses → "Distributed Locks" → first lesson**:

```
Browser                         FastAPI                          Postgres / Mongo
   │                                │                                   │
   │ GET /api/v1/lessons/course/42  │                                   │
   ├──────────────────────────────►│                                   │
   │                                │ require_auth (cookie → JWT)       │
   │                                │ LessonService.list_by_course(42)  │
   │                                ├─► SELECT * FROM lessons …────────►│
   │                                │◄──── lessons[] ──────────────────│
   │◄─── [{id, name, nosql_id, …}] │                                   │
   │                                │                                   │
   │ POST /api/v1/progress/courses/42/lessons/5/complete              │
   ├──────────────────────────────►│ ProgressService.complete_lesson   │
   │                                ├─► INSERT user_lesson_progress ──►│
   │◄─── CourseProgress ────────────│                                   │
```

The `nosql_id` UUID on each `lessons` row is the bridge from Postgres into Mongo. It points to a `lesson_blocks` document.

## Frontend layering

```
pages/                ← route components (own data fetching + state)
  ├─ services/        ← thin HTTP wrappers around api.ts
shared/
  ├─ components/
  │   ├─ atoms/       ← Button, Input, Tag, Chip… (no app state)
  │   ├─ molecules/   ← CourseCard, OAuthButton… (small composites)
  │   └─ organisms/   ← CourseBoard, LessonsPanel, LoginForm… (feature-shaped)
  ├─ types/           ← shared TS types (index.ts)
context/              ← AuthContext, FeatureFlagContext
hooks/                ← useTheme, useFeatureFlag, useCopilotNav
styles/tokens.css     ← design tokens (light + dark)
```

Rule: **pages own state and call services**. Components below the page are presentational — props in, events out.

## Backend layering

```
api/v1/controllers/   ← HTTP shape: parse request, call service, return schema
services/             ← business logic, orchestration across repos
repositories/         ← DB shape: SQL queries or Beanie queries, no logic
schemas/              ← Pydantic request/response models
models/               ← SQLAlchemy + Beanie ORM models
dependencies/         ← DI wiring (get_db, get_*_service, require_auth, …)
core/                 ← config + logging
db/                   ← engine, session, Base
middleware.py         ← CORS + CopilotKit auth + context capture
main.py               ← app factory + lifespan (Beanie init)
```

Rule: **controllers → services → repositories**, never skip. A controller never queries the DB. A repository never raises an HTTP exception.

## Auth at a glance

- Login or OAuth issues two JWTs:
  - `access_token` (15 min) — short-lived, used for every API call.
  - `refresh_token` (7 days) — has a `jti` row in `refresh_tokens` so it can be revoked.
- Both go into **HttpOnly, SameSite=Lax cookies**. JS can never read them.
- On 401, the FE's `api.ts` silently `POST`s `/auth/refresh`, retries the original request, and only redirects to `/login` if refresh itself fails.
- Logout revokes the `jti` and clears both cookies.

Full detail: [`features/auth.md`](./features/auth.md).

## Where things run (Docker Compose)

| Service | Image / build | Port | Depends on |
|---|---|---|---|
| `db` | `pgvector/pgvector:pg17` | 5432 | — |
| `mongo` | `mongo:8` | 27017 | — |
| `backend` | `./backend/Dockerfile` (Python 3.14, uv) | 8000 | `db` (healthy) |
| `frontend` | `./frontend/Dockerfile` | 5173 → 80 | — |

Day-to-day tasks (start services, run tests, lint, migrate) use the `just` task runner — see [`reference/justfile.md`](./reference/justfile.md). `.env` at the repo root supplies all the env vars listed in [`reference/backend-infrastructure.md`](./reference/backend-infrastructure.md#configuration).
