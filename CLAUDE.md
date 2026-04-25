# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Project Hannibal is a full-stack web app with a FastAPI backend and React/TypeScript frontend. The stack:
- **Backend**: FastAPI + SQLAlchemy + PostgreSQL + Alembic + JWT auth (python-jose) + bcrypt
- **Frontend**: React 19 + TypeScript + Vite + CSS Modules (no Tailwind)
- **Infrastructure**: Docker Compose (Postgres + backend + frontend)

## Commands

### Backend (run from `backend/`)

```bash
# Install dependencies
uv sync

# Run dev server
uv run python main.py

# Run all tests
uv run pytest

# Run a single test file
uv run pytest tests/test_auth_controller.py

# Run a single test
uv run pytest tests/test_auth_controller.py::TestRegister::test_success_returns_201

# Database migrations
uv run alembic upgrade head
uv run alembic revision --autogenerate -m "description"
```

### Frontend (run from `frontend/`)

```bash
npm install
npm run dev       # Vite dev server
npm run build     # tsc + vite build
npm run lint      # ESLint
```

### Full stack

```bash
docker compose up --build   # Starts Postgres, backend (:8000), frontend (:5173)
```

## Architecture

### Backend layer structure

```
app/
  api/v1/controllers/   # FastAPI route handlers (thin — delegate to services)
  services/             # Business logic (AuthService, HealthService)
  repositories/         # DB access layer (UserRepository, HealthRepository)
  models/               # SQLAlchemy ORM models
  schemas/              # Pydantic request/response schemas
  dependencies/         # FastAPI DI providers (get_auth_service, etc.)
  core/                 # Config (Settings dataclass) + logging setup
  db/                   # SQLAlchemy engine/session setup
```

Controllers call services; services call repositories — never skip layers. The `dependencies/` module wires these together via FastAPI's `Depends()`.

API prefix: `/api/v1`. Routes: `GET /health`, `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`.

### Backend config

`app/core/config.py` reads from environment variables with defaults. Key vars: `SECRET_KEY`, `JWT_ALGORITHM`, `ACCESS_TOKEN_EXPIRE_MINUTES`. The `.env` file (not committed) is consumed by Docker Compose.

### Backend tests

Tests use FastAPI's `TestClient` and `pytest-mock`. Services are mocked via `app.dependency_overrides` — do not hit the real DB. Each test class corresponds to one endpoint (TestRegister, TestLogin, TestLogout).

### Frontend structure

```
src/
  pages/           # Full pages (Login, Storyboard)
  shared/
    components/
      atoms/       # Primitive UI (Button, Input, Badge, etc.)
      molecules/   # Composed components (InputField, LoginForm, OAuthButton, etc.)
      organisms/   # Full sections (Navbar, LoginForm, AuthFlowDiagram, etc.)
    types/         # Shared TypeScript types
  styles/          # tokens.css — CSS custom properties (--ink, --paper, --accent, etc.)
```

Path alias `@/*` maps to `src/*`. All shared components are re-exported from `@/shared/components`.

No router is installed — `App.tsx` renders a single page directly. Add React Router when multi-page navigation is needed.

### Frontend design system

CSS Modules only. Design tokens are CSS custom properties defined in `src/styles/tokens.css`. Dark mode via `[data-theme="dark"]` on `document.documentElement`. See `frontend/COMPONENTS.md` for the full component catalogue with props.

**Theme management pattern** (required on every page):
```tsx
const [theme, setTheme] = useState<Theme>("light");
useEffect(() => {
  document.documentElement.setAttribute("data-theme", theme);
}, [theme]);
```

**New page checklist**: create `src/pages/<Name>/<Name>.tsx` + `<Name>.module.css`, use `PaperBg` for background, manage theme as above, update `App.tsx`.
