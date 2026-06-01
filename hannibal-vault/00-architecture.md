# Architecture

Project Hannibal is a three-tier web app with a fourth side-car service for code transformations.

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
                                       │ (users,        │  │ (build_blocks│
                                       │  courses,      │  │  lesson_     │
                                       │  lessons,      │  │  blocks,     │
                                       │  tags,         │  │  nodes)      │
                                       │  refresh_tokens│  │              │
                                       └────────────────┘  └──────────────┘
                                                │
                                                │ HTTP
                                                ▼
                                       ┌────────────────────────────────┐
                                       │ DSL service (9000)             │
                                       │ translates build-block templates│
                                       │ + runs Docker-sandboxed code   │
                                       └────────────────────────────────┘
```

## Stack

| Tier | Tech | Notes |
|---|---|---|
| Frontend | React 19, TypeScript, Vite, React Router v6, CSS Modules | `bun` package manager. No state library — local state + Context. |
| Backend | FastAPI, SQLAlchemy 2 (sync), Beanie (async Mongo), Pydantic 2, JWT (python-jose), bcrypt, httpx | `uv` package manager. Python 3.14. |
| DBs | PostgreSQL 17, MongoDB 8 | Postgres holds relational data; Mongo holds blob-shaped content (markdown lesson bodies, code templates, node graphs). |
| AI | Google ADK + Gemini 2.5 Flash via CopilotKit | Powers the in-app `CopilotPopup` and the Home-page agent chat. |
| Sandbox | Docker SDK | RCE runs untrusted user code in throwaway containers with `cap_drop=[ALL]`, read-only fs, no network. |

## Why two databases?

Postgres is the source of truth for **identity and structure** — who the user is, which courses and lessons exist, how they're ordered, what tag they belong to. Foreign keys matter here.

Mongo is the store for **content** — the long-form markdown body of a lesson, the code template + test harness + multiple test cases of a build block, the node graph used to render the live canvas. These are blob-shaped, vary in shape across lessons, and are referenced from Postgres by UUID (`lessons.nosql_id`).

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
   │ GET /api/v1/build-blocks/<UUID>│                                   │
   ├──────────────────────────────►│                                   │
   │                                │ BuildBlockService.get_block(uuid) │
   │                                ├─► Mongo: build_blocks.find_one ──►│
   │                                │◄──── {code_template, tests, …} ──│
   │◄─── BuildBlockResponse ────────│                                   │
   │                                │                                   │
   │ POST /api/v1/run-code/run-simple                                  │
   ├──────────────────────────────►│ run_simple() → Docker sandbox     │
   │◄─── {stdout, exit_code, …} ───│                                   │
```

The `nosql_id` UUID on each `lessons` row is the bridge from Postgres into Mongo. For a `learn` lesson it points to a `lesson_blocks` document; for a `build` lesson it points to a `build_blocks` document.

## Frontend layering

```
pages/                ← route components (own data fetching + state)
  ├─ services/        ← thin HTTP wrappers around api.ts
shared/
  ├─ components/
  │   ├─ atoms/       ← Button, Input, Tag, Chip… (no app state)
  │   ├─ molecules/   ← CourseCard, CodeEditor, OAuthButton… (small composites)
  │   └─ organisms/   ← CourseBoard, LessonsPanel, LoginForm… (feature-shaped)
  ├─ utils/           ← pure helpers (edgePath)
  ├─ types/           ← shared TS types (course, board)
context/              ← AuthContext only
hooks/                ← useTheme only
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
exception/            ← typed errors (UnsupportedLanguage, TestCodeSyntaxFailure)
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
| `db` | `postgres:17-alpine` | 5432 | — |
| `mongo` | `mongo:8` | 27017 | — |
| `backend` | `./backend/Dockerfile` (Python 3.14, uv) | 8000 | `db` (healthy), `dsl-service` |
| `frontend` | `./frontend/Dockerfile` | 5173 → 80 | — |
| `dsl-service` | `./dsl-service/Dockerfile` | 9000 | — |

`hannibal-dev.sh` is the dev launcher. `.env` at the repo root supplies all the env vars listed in [`reference/backend-infrastructure.md`](./reference/backend-infrastructure.md#configuration).
