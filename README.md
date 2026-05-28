# Project Hannibal

An AI-powered learning platform with an interactive tutor, diagram canvas, sandboxed code execution, and a course catalogue. Built with FastAPI + React 19.

## Features

- **AI Tutor** — CopilotKit chat powered by Google ADK + Gemini 2.5 Flash
- **Sandboxed Code Execution** — Runs Python and JavaScript in isolated Docker containers (no network, memory/PID limits, 10s timeout); supports free-form execution and build-block test harness injection
- **Course Catalogue** — Browse, filter, and get AI-curated learning paths
- **Google OAuth + JWT Auth** — HttpOnly cookie-based sessions (no localStorage)
- **Interactive Diagram Canvas** — Draggable nodes with SVG edge routing

## Stack

| Layer | Technology |
|---|---|
| Backend | FastAPI · SQLAlchemy · PostgreSQL 17 · Alembic |
| Auth | JWT (HttpOnly cookies) · bcrypt · Google OAuth 2.0 |
| AI | Google ADK · Gemini 2.5 Flash · CopilotKit |
| Frontend | React 19 · TypeScript · Vite · React Router v6 · CSS Modules |
| Infra | Docker Compose |

## Architecture

```
Client
  └── FastAPI (port 8000)
        ├── /api/v1/auth      — register, login, logout, refresh, Google OAuth
        ├── /api/v1/health    — liveness check
        ├── /api/v1/rce       — sandboxed code execution (auth required)
        ├── /api/v1/run-code  — build-block test harness execution (auth required)
        └── /api/v1/copilotkit — SSE streaming AI agent

DSL Service (port 9000) — work in progress
  └── POST /translate       — converts build-block DSL to runnable code for a target language

React (port 5173)
  └── App
        ├── AuthProvider      — user session state
        ├── CopilotKit        — AI chat wiring
        └── Routes
              ├── /home       — AI tutor + diagram canvas
              ├── /login      — email/password + Google OAuth
              ├── /courses    — catalogue + AI recommendations
              └── /courses/:id — course player with build blocks + code runner
```

Backend follows a strict **controllers → services → repositories** layering. Frontend follows **pages → organisms → molecules → atoms** (atomic design).

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
| DSL Service | http://localhost:9000 | work in progress — optional, backend starts without it |

### 3. Run database migrations

```bash
docker compose exec backend alembic upgrade head
```

## Development

### Backend (without Docker)

```bash
cd backend
uv sync
uv run uvicorn app.main:app --reload --port 8000
```

### Frontend (without Docker)

```bash
cd frontend
bun install
bun dev
```

### Tests

```bash
cd backend
uv run pytest --cov=app --cov-report=term-missing
```

All tests use FastAPI `TestClient` with mocked services — no real DB required.

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
| POST | `/api/v1/rce/execute` | cookie | Execute Python or JavaScript |
| POST | `/api/v1/run-code/run-simple` | cookie | Run user code against a build block's test harness |
| POST | `/api/v1/copilotkit` | — | CopilotKit SSE endpoint |

### Code Execution

```bash
# Free-form execution
curl -X POST http://localhost:8000/api/v1/rce/execute \
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

Sandbox limits: 10 s timeout · 128 MB memory · 10 PIDs · no network · max 5 concurrent runs

## Project Structure

```
project-hannibal/
├── backend/
│   ├── app/
│   │   ├── api/v1/controllers/   # HTTP handlers
│   │   ├── services/
│   │   │   └── rce/              # Docker execution: config, docker, result, run_simple
│   │   ├── repositories/         # DB access
│   │   ├── models/               # SQLAlchemy ORM + Beanie documents
│   │   ├── schemas/              # Pydantic models
│   │   ├── dependencies/         # FastAPI DI
│   │   ├── core/                 # Config + logging
│   │   └── db/                   # Engine + session
│   ├── tests/
│   └── alembic/
├── frontend/
│   └── src/
│       ├── pages/                # Route components
│       ├── context/              # Auth state
│       ├── hooks/                # useTheme, etc.
│       ├── services/             # API fetch wrapper
│       └── shared/components/    # atoms / molecules / organisms
├── dsl-service/                  # WIP — translates build-block DSL to target language code
├── hannibal-vault/               # Codebase documentation (Obsidian)
└── docker-compose.yml
```

## Code Quality Standards

- No function over 150 lines
- 100% test coverage
- <1% duplicate code
- No comments — names explain intent
