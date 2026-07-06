# Project Hannibal

An AI-powered learning platform with an interactive tutor, diagram canvas, sandboxed code execution, and a course catalogue. Built with FastAPI + React 19.

## Features

- **AI Tutor** — CopilotKit chat powered by a LangGraph agent on Gemini 2.5 Flash
- **Sandboxed Code Execution** — Runs Python and JavaScript in isolated Docker containers (no network, read-only FS, dropped capabilities, memory/PID limits, 10s timeout); free-form execution, live output streaming (SSE), and build-block test harness injection. Executed by a standalone `rce-service` worker reached over RabbitMQ — the API process never touches the Docker socket. Per-language dependency detection with an install allowlist and warm package cache
- **Course Catalogue** — Browse, filter, and manage courses/lessons with tag-based organization and per-user progress tracking
- **Google OAuth + JWT Auth** — HttpOnly cookie-based sessions (no localStorage)
- **Interactive Diagram Canvas** — Draggable nodes with SVG edge routing

## Stack

| Layer | Technology |
|---|---|
| Backend | FastAPI · SQLAlchemy · PostgreSQL 17 (pgvector) · MongoDB (Beanie) · Alembic |
| Code Execution | RabbitMQ (job queue + event streaming) · standalone `rce-service` worker · Docker sandbox |
| Auth | JWT (HttpOnly cookies) · bcrypt · Google OAuth 2.0 |
| AI | LangGraph · langchain-google-genai · Gemini 2.5 Flash · CopilotKit |
| Frontend | React 19 · TypeScript · Vite · React Router v6 · CSS Modules |
| Infra | Docker Compose |

## Architecture

```
Client
  └── FastAPI (port 8000)
        ├── /api/v1/auth           — register, login, logout, refresh, Google OAuth
        ├── /api/v1/health         — liveness check
        ├── /api/v1/rce            — sandboxed code execution (auth required) ─┐
        ├── /api/v1/rce/packages   — dependency search + existence check      │
        ├── /api/v1/run-code       — build-block test harness execution ──────┤
        ├── /api/v1/courses …      — courses, lessons, blocks, tags, progress │
        └── /api/v1/copilotkit     — SSE streaming AI agent                   │
                                                                               │
                                                RabbitMQ (job queue + events) ◄┘
                                                  │
                                                  ▼
                                          rce-service worker
                                            └── Docker sandbox (no network, 10s timeout)

DSL Service (port 9000) — work in progress
  └── POST /translate       — converts build-block DSL to runnable code for a target language

React (port 5173)
  └── App
        ├── AuthProvider      — user session state
        ├── CopilotKit        — AI chat wiring
        └── Routes
              ├── /home       — AI tutor + diagram canvas
              ├── /login      — email/password + Google OAuth
              ├── /courses    — catalogue
              └── /courses/:id — course player with build blocks + code runner
```

Backend follows a strict **controllers → services → repositories** layering. Frontend follows **pages → organisms → molecules → atoms** (atomic design). The backend never holds the Docker socket — it publishes execution jobs to RabbitMQ and relays the worker's replies/events back to the client, so `rce-service` is the only process with sandbox access.

## Getting Started

### Prerequisites

- Docker + Docker Compose
- A Google Cloud project with OAuth 2.0 credentials (for Google login)
- A Google AI Studio API key (for the AI tutor)

### 1. Configure environment

Copy the example env file and fill in the values:

```bash
cp .env.example .env
```

Required variables:

```env
# Postgres
POSTGRES_USER=hannibal
POSTGRES_PASSWORD=<your-password>
POSTGRES_DB=hannibal

# MongoDB
MONGO_USER=hannibal
MONGO_PASSWORD=<your-password>
MONGO_DB=hannibal
MONGO_URL=mongodb://hannibal:<password>@mongo:27017

# RabbitMQ (RCE job queue — backend and rce-service both connect to this)
RABBITMQ_USER=hannibal
RABBITMQ_PASSWORD=<your-password>
RABBITMQ_URL=amqp://hannibal:<password>@rabbitmq:5672/

# App
SECRET_KEY=<random-256-bit-hex>
DATABASE_URL=postgresql://hannibal:<password>@db:5432/hannibal

# Google OAuth
GOOGLE_CLIENT_ID=<your-client-id>
GOOGLE_CLIENT_SECRET=<your-client-secret>
GOOGLE_REDIRECT_URI=http://localhost:8000/api/v1/auth/google/callback

# AI
GEMINI_API_KEY=<your-gemini-key>
```

### 2. Start the stack

```bash
docker compose up --build
```

| Service | URL | Notes |
|---|---|---|
| Frontend | http://localhost:5173 | |
| Backend API | http://localhost:8000 | |
| API Docs | http://localhost:8000/docs | |
| RabbitMQ management UI | http://localhost:15672 | broker for RCE job queue + event streaming |
| DSL Service | http://localhost:9000 | work in progress — optional, backend starts without it |

`rce-service` has no HTTP port — it only consumes jobs from RabbitMQ and needs the host Docker socket, so it must run alongside Docker Compose (not as a bare `uvicorn`-style process).

### 3. Run database migrations

```bash
docker compose exec backend alembic upgrade head
```

### 4. Seed the database

Populates PostgreSQL and MongoDB with enough data to explore every feature:

```bash
cd backend && uv run python ../scripts/seed.py
```

| Store      | Seeded data                                              |
|------------|----------------------------------------------------------|
| PostgreSQL | 2 users, 5 tags, 3 courses, 12 lessons                  |
| MongoDB    | 12 lesson blocks, 4 build blocks                        |

**Seed credentials**

| Email                | Password     | Role    |
|----------------------|--------------|---------|
| admin@hannibal.dev   | Admin1234!   | admin   |
| student@hannibal.dev | Student1234! | student |

The script is idempotent — re-running it truncates and repopulates without duplicating data.
See [`scripts/README.md`](scripts/README.md) for details and how to extend the dataset.

## Development

### Backend (without Docker)

```bash
cd backend
uv sync
uv run uvicorn app.main:app --reload --port 8000
```

Code execution still needs RabbitMQ and `rce-service` reachable (they hold the Docker socket) — run `docker compose up -d rabbitmq rce-service` alongside the local backend, or those calls will 503.

### rce-service (without Docker)

```bash
cd rce-service
uv sync
uv run python -m rce_service.main
```

Requires a reachable Docker daemon (mounts `/var/run/docker.sock`) and `RABBITMQ_URL` pointed at a running broker.

### Frontend (without Docker)

```bash
cd frontend
bun install
bun --bun dev
```

### Tests

```bash
cd backend
uv run pytest --cov=app --cov-report=term-missing

cd rce-service
uv run pytest --cov=rce_service --cov-report=term-missing
```

All tests use FastAPI `TestClient` / mocked Docker + broker clients — no real DB, Docker daemon, or RabbitMQ required.

### Pre-commit hooks

Lint and format checks run automatically on every commit (ruff + ESLint). Install once after cloning:

```bash
uv run --directory backend pre-commit install
```

To run manually against all files:

```bash
uv run --directory backend pre-commit run --all-files
```

## API Reference

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/v1/auth/register` | — | Create account |
| POST | `/api/v1/auth/login` | — | Email/password login |
| POST | `/api/v1/auth/logout` | cookie | Revoke session |
| POST | `/api/v1/auth/refresh` | cookie | Rotate access token |
| GET | `/api/v1/auth/google` | — | Start Google OAuth flow |
| GET | `/api/v1/auth/google/callback` | — | OAuth redirect handler |
| GET | `/api/v1/health` | — | Liveness check |
| POST | `/api/v1/rce/execute` | cookie | Execute Python or JavaScript, wait for the full result |
| POST | `/api/v1/rce/execute/stream` | cookie | Same, streamed as SSE (`stdout`/`stderr`/`exit`/`error` events) |
| GET | `/api/v1/rce/packages/search` | — | Prefix-search installable packages for a language |
| GET | `/api/v1/rce/packages/verify` | — | Check whether a package name exists in its registry |
| POST | `/api/v1/run-code/run-simple` | cookie | Run user code against a build block's test harness |
| POST | `/api/v1/copilotkit` | — | CopilotKit SSE endpoint |

Courses, lessons, lesson/build blocks, tags, node placement, progress, and user preferences each have their own router (`/api/v1/courses`, `/lessons`, `/lesson-blocks`, `/build-blocks`, `/blocks`, `/tags`, `/nodes`, `/progress`, `/user-preferences`) — see http://localhost:8000/docs for the complete, always-current list.

### Code Execution

Free-form execution and the build-block test harness are handled by the same FastAPI routes as before — the backend now fulfils them by publishing a job to RabbitMQ and awaiting/relaying the `rce-service` worker's reply instead of driving Docker in-process. The request/response contracts are unchanged.

```bash
# Free-form execution
curl -X POST http://localhost:8000/api/v1/rce/execute \
  -H "Content-Type: application/json" \
  -b "access_token=<token>" \
  -d '{"language": "python", "code": "print(\"hello\")"}'

# Streamed output (SSE)
curl -N -X POST http://localhost:8000/api/v1/rce/execute/stream \
  -H "Content-Type: application/json" \
  -b "access_token=<token>" \
  -d '{"language": "python", "code": "print(\"hello\")"}'

# Build block test run (injects code into the block's test harness)
curl -X POST http://localhost:8000/api/v1/run-code/run-simple \
  -H "Content-Type: application/json" \
  -b "access_token=<token>" \
  -d '{"language": "python", "code": "def solve(): return 42", "block_id": "<uuid>"}'
```

Supported languages: `python`, `javascript`

Sandbox limits (enforced in `rce-service`): 10 s timeout · 128 MB memory · 10 PIDs · no network · read-only filesystem · worker concurrency 5. A full job queue returns **429**; a worker RPC timeout returns **504**; a down broker returns **503**.

## Project Structure

```
project-hannibal/
├── backend/
│   ├── app/
│   │   ├── api/v1/controllers/   # HTTP handlers
│   │   ├── agent/                # LangGraph AI tutor (nodes, tools, prompts)
│   │   ├── services/
│   │   │   ├── rce_gateway/      # RabbitMQ RPC client + SSE relay to rce-service
│   │   │   └── package_search/  # dependency search/verify (stayed in-process, needs Postgres + registry HTTP)
│   │   ├── repositories/         # DB access
│   │   ├── models/               # SQLAlchemy ORM (incl. pgvector embeddings) + Beanie documents
│   │   ├── schemas/              # Pydantic models
│   │   ├── dependencies/         # FastAPI DI
│   │   ├── core/                 # Config + logging
│   │   └── db/                   # Engine + session
│   ├── tests/
│   └── alembic/
├── rce-service/                  # Standalone worker: consumes RabbitMQ jobs, runs code in Docker sandboxes
│   └── rce_service/
│       ├── main.py               # Broker connection + consume loop
│       ├── handlers.py           # sync/stream job handling
│       ├── docker.py             # the sandbox itself
│       ├── two_phase.py          # dependency resolution → allowlist → install
│       └── deps/                 # per-language import detection + registries
├── frontend/
│   └── src/
│       ├── pages/                # Route components
│       ├── context/              # Auth state
│       ├── hooks/                # useTheme, etc.
│       ├── services/             # API fetch wrapper
│       └── shared/components/    # atoms / molecules / organisms
├── dsl-service/                  # WIP — translates build-block DSL to target language code (Rust)
├── scripts/                      # Dev tooling (seed.py, seed_data.py)
├── hannibal-vault/               # Codebase documentation (Obsidian)
└── docker-compose.yml            # db, mongo, rabbitmq, backend, rce-service, frontend, dsl-service
```

## Code Quality Standards

- No function over 150 lines
- 100% test coverage
- <1% duplicate code
- No comments — names explain intent
