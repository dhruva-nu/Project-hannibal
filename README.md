# Project Hannibal

An AI-powered learning platform with an interactive tutor, design board, and a course catalogue of theory lessons. Built with FastAPI + React 19.

## Features

- **AI Tutor** — CopilotKit chat powered by a LangGraph agent on Gemini 2.5 Flash
- **Course Catalogue** — Browse, filter, and manage courses/lessons with tag-based organization and per-user progress tracking
- **Google OAuth + JWT Auth** — HttpOnly cookie-based sessions (no localStorage)
- **Design Board** — Free-form canvas with draggable nodes and SVG edge routing
- **Feature Flags** — Server-evaluated flags (role targeting + percentage rollout)

## Stack

| Layer | Technology |
|---|---|
| Backend | FastAPI · SQLAlchemy · PostgreSQL 17 (pgvector) · MongoDB (Beanie) · Alembic |
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
        ├── /api/v1/courses …      — courses, lessons, lesson-blocks, tags, progress, feature-flags, user-preferences
        └── /api/v1/copilotkit     — SSE streaming AI agent

React (port 5173)
  └── App
        ├── AuthProvider      — user session state
        ├── CopilotKit        — AI chat wiring
        └── Routes
              ├── /home       — AI tutor + hero demo
              ├── /login      — email/password + Google OAuth
              ├── /courses    — catalogue
              └── /courses/:id — course player (lesson list, theory, design tab)
              ├── /storyboard — component showcase
              └── /design-board — free-form design canvas
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

# MongoDB
MONGO_USER=hannibal
MONGO_PASSWORD=<your-password>
MONGO_DB=hannibal
MONGO_URL=mongodb://hannibal:<password>@mongo:27017

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
| MongoDB    | 12 lesson blocks                                        |

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
```

All tests use FastAPI `TestClient` with mocked services — no real DB required.

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
| POST | `/api/v1/copilotkit` | — | CopilotKit SSE endpoint |

Courses, lessons, lesson blocks, tags, progress, feature flags, and user preferences each have their own router (`/api/v1/courses`, `/lessons`, `/lesson-blocks`, `/tags`, `/progress`, `/feature-flags`, `/admin/feature-flags`, `/user-preferences`) — see http://localhost:8000/docs for the complete, always-current list.

## Project Structure

```
project-hannibal/
├── backend/
│   ├── app/
│   │   ├── api/v1/controllers/   # HTTP handlers
│   │   ├── agent/                # LangGraph AI tutor (nodes, tools, prompts)
│   │   ├── services/
│   │   ├── repositories/         # DB access
│   │   ├── models/               # SQLAlchemy ORM (incl. pgvector embeddings) + Beanie documents
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
├── scripts/                      # Dev tooling (seed.py, seed_data.py)
├── hannibal-vault/               # Codebase documentation (Obsidian)
└── docker-compose.yml            # db, mongo, backend, frontend
```

## Code Quality Standards

- No function over 150 lines
- 100% test coverage
- <1% duplicate code
- No comments — names explain intent
