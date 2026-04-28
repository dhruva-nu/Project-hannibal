# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## CopilotKit

For any task involving CopilotKit (AI chat, agent tools, shared state, runtime endpoint, `useCopilotReadable`, `useAgent`, `CopilotPopup`, etc.) read **[copilotkit-docs.md](./copilotkit-docs.md)** first. It contains the installed package versions, wiring decisions, implementation patterns, and common pitfalls specific to this project.

**Current state:** CopilotKit is fully implemented. The backend agent (`GoogleADKAgent` in `copilotkit_controller.py`) wraps Google ADK's `LlmAgent` with Gemini 2.5 Flash. The frontend uses `CopilotPopup` placed inside `CopilotKit` but outside `Routes`. Requires `GEMINI_API_KEY` in `.env`.

## Project Overview

Project Hannibal is a full-stack web app with a FastAPI backend and React/TypeScript frontend. The stack:
- **Backend**: FastAPI + SQLAlchemy + PostgreSQL + Alembic + JWT auth (python-jose) + bcrypt + Google ADK (Gemini)
- **Frontend**: React 19 + TypeScript + Vite + React Router v6 + CSS Modules (no Tailwind)
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

API prefix: `/api/v1`. Routes:
- `GET /health`
- `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `POST /auth/refresh`
- `GET /auth/google` (initiates OAuth), `GET /auth/google/callback` (OAuth redirect handler)
- `POST /copilotkit` (CopilotKit runtime — SSE streaming)

### Auth implementation

Auth tokens are stored as **HttpOnly cookies** (`access_token` + `refresh_token`), never in headers or local storage. Login sets both cookies; logout clears them. Google OAuth flow: `/auth/google` → Google → `/auth/google/callback` → sets cookies → redirects to `/home`.

### Backend config

`app/core/config.py` reads from environment variables. Key vars: `SECRET_KEY`, `JWT_ALGORITHM`, `ACCESS_TOKEN_EXPIRE_MINUTES`, `REFRESH_TOKEN_EXPIRE_DAYS`, `COOKIE_SECURE`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GEMINI_API_KEY`, `FRONTEND_ORIGIN`. The `.env` file (not committed) is consumed by Docker Compose.

### Backend tests

Tests use FastAPI's `TestClient` and `pytest-mock`. Services are mocked via `app.dependency_overrides` — do not hit the real DB. Each test class corresponds to one endpoint (TestRegister, TestLogin, TestLogout).

### Frontend structure

```
src/
  pages/           # Full pages (Login, Home; Storyboard exists but is not routed)
  context/         # AuthContext.tsx — useAuth() hook provides {user, setUser, logout}
  services/        # api.ts — all API calls go through this, never directly in components
  shared/
    components/
      atoms/       # Primitive UI (Button, Input, Badge, etc.)
      molecules/   # Composed components (InputField, OAuthButton, etc.)
      organisms/   # Full sections (Navbar, LoginForm, AuthFlowDiagram, etc.)
    types/         # Shared TypeScript types
  styles/          # tokens.css — CSS custom properties (--ink, --paper, --accent, etc.)
```

Path alias `@/*` maps to `src/*`. All shared components are re-exported from `@/shared/components`.

**Routing:** React Router v6 is installed. Routes: `/login` → `Login`, `/home` → `Home`, `/` redirects to `/home`. `App.tsx` tree order: `BrowserRouter > AuthProvider > CopilotKit > Routes + CopilotPopup`.

**New page checklist**: create `src/pages/<Name>/<Name>.tsx` + `<Name>.module.css`, add a `<Route>` in `App.tsx`, use `PaperBg` for background, manage theme as below.

### Frontend design system

CSS Modules only. Design tokens are CSS custom properties defined in `src/styles/tokens.css`. Dark mode via `[data-theme="dark"]` on `document.documentElement`. See `frontend/COMPONENTS.md` for the full component catalogue with props.

**Theme management pattern** (required on every page):
```tsx
const [theme, setTheme] = useState<Theme>("light");
useEffect(() => {
  document.documentElement.setAttribute("data-theme", theme);
}, [theme]);
```
