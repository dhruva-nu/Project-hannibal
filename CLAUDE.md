# CLAUDE.md

## Stack

- **Backend**: FastAPI + SQLAlchemy + PostgreSQL + Alembic + JWT (HttpOnly cookies) + bcrypt + Google ADK (Gemini)
- **Frontend**: React 19 + TypeScript + Vite + React Router v6 + CSS Modules
- **Infrastructure**: Docker Compose (Postgres + backend :8000 + frontend :5173)

## Backend exploration

Before exploring the backend, read **`hannibal-vault/00 - Backend Overview.md`** — it is the map of content for the entire backend. It has the layer diagram, all file links, and the connection rules between layers. Only read individual files after you know which ones are relevant from the vault.

Layer rule: controllers → services → repositories. Never skip layers.

## CopilotKit

For any CopilotKit task read **[copilotkit-docs.md](./copilotkit-docs.md)** first. Contains package versions, wiring decisions, and pitfalls.

Current state: `GoogleADKAgent` in `copilotkit_controller.py` wraps Google ADK's `LlmAgent` with Gemini 2.5 Flash. Frontend uses `CopilotPopup` inside `CopilotKit` but outside `Routes`. Requires `GEMINI_API_KEY` in `.env`.

## Commands

```bash
# Backend (from backend/)
uv sync
uv run python main.py
uv run pytest
uv run alembic upgrade head

# Frontend (from frontend/)
npm install && npm run dev

# Full stack
docker compose up --build
```

## Frontend

```
src/
  pages/        # Full pages (Login, Home)
  context/      # AuthContext.tsx — useAuth() hook
  services/     # api.ts — all API calls go here, never in components
  shared/
    components/
      atoms/     # Primitive UI
      molecules/ # Composed components
      organisms/ # Full sections (Navbar, LoginForm, etc.)
    types/
  styles/        # tokens.css — CSS custom properties
```

Path alias `@/*` → `src/*`. Components re-exported from `@/shared/components`.

Routes: `/login` → `Login`, `/home` → `Home`, `/` → redirect to `/home`. `App.tsx` order: `BrowserRouter > AuthProvider > CopilotKit > Routes + CopilotPopup`.

**New page checklist**: `src/pages/<Name>/<Name>.tsx` + `<Name>.module.css`, add `<Route>` in `App.tsx`, use `PaperBg` for background.

**Theme pattern** (required on every page):
```tsx
const [theme, setTheme] = useState<Theme>("light");
useEffect(() => {
  document.documentElement.setAttribute("data-theme", theme);
}, [theme]);
```

CSS Modules only. Dark mode via `[data-theme="dark"]` on `document.documentElement`. See `frontend/COMPONENTS.md` for the component catalogue.

## Tests

`backend/tests/` — FastAPI `TestClient` + `pytest-mock`. Services mocked via `app.dependency_overrides`. Never hit the real DB.
