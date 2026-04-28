# CLAUDE.md

## How to navigate this codebase

**The vault is the primary documentation.** Before reading any source file, read the relevant vault note first. Vault notes contain line numbers for every major function — use those to jump directly to the right section instead of scanning whole files.

### Vault location

```
hannibal-vault/
  00 - Backend Overview.md     ← start here for any backend task
  frontend/
    00 - Frontend Overview.md  ← start here for any frontend task
```

### Workflow for any task

1. **Read the MOC first** — `00 - Backend Overview.md` or `frontend/00 - Frontend Overview.md`. It has the full layer diagram, file list, and connection rules.
2. **Follow the link to the relevant folder note** (`_folder.md`) — gives the sub-tree for that domain.
3. **Follow the link to the relevant file note** — gives the function list with start/end line numbers and what each function calls.
4. **Read only those lines** in the actual source file. Do not read files top-to-bottom.
5. **Branch out** via `Calls:` and `Imports:` links in the vault note if you need to follow a dependency.

### Example

> Task: "fix the Google OAuth callback"

1. Read `hannibal-vault/00 - Backend Overview.md` → see `auth_controller` in the Controllers section
2. Read `hannibal-vault/app/api/v1/controllers/auth_controller.md` → find `google_callback` at lines 121–145, calls `auth_service.verify_oauth_state` and `auth_service.handle_google_callback`
3. Read `backend/app/api/v1/controllers/auth_controller.py` lines 121–145 only
4. If the bug is in the service, follow to `hannibal-vault/app/services/auth_service.md` → `handle_google_callback` at lines 107–145
5. Read that range in `auth_service.py`

---

## Stack

- **Backend**: FastAPI + SQLAlchemy + PostgreSQL + Alembic + JWT (HttpOnly cookies) + bcrypt + Google ADK (Gemini)
- **Frontend**: React 19 + TypeScript + Vite + React Router v6 + CSS Modules
- **Infrastructure**: Docker Compose (Postgres + backend :8000 + frontend :5173)

## Layer rules

**Backend** — controllers → services → repositories. Never skip layers.

**Frontend** — pages → organisms → molecules → atoms. Pages call `services/api.ts` for HTTP; never fetch directly in components or context.

## CopilotKit

For any CopilotKit task read **[copilotkit-docs.md](./copilotkit-docs.md)** first. Contains package versions, wiring decisions, and pitfalls.

Current state: `GoogleADKAgent` in `copilotkit_controller.py` wraps Google ADK's `LlmAgent` with Gemini 2.5 Flash. Frontend uses `CopilotPopup` inside `CopilotKit` but outside `Routes`. Requires `GEMINI_API_KEY` in `.env`.

Vault note: `hannibal-vault/app/api/v1/controllers/copilotkit_controller.md`

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

## Auth

Tokens are HttpOnly cookies (`access_token` + `refresh_token`). Login sets both; logout clears them. Never use localStorage or Authorization headers.

Vault notes: `hannibal-vault/app/services/auth_service.md` · `hannibal-vault/app/api/v1/controllers/auth_controller.md` · `hannibal-vault/frontend/src/services/api.md`

## New page checklist (frontend)

1. `src/pages/<Name>/<Name>.tsx` + `<Name>.module.css`
2. Add `<Route>` in `App.tsx`
3. Use `PaperBg` for background
4. Use `useTheme()` from `hooks/useTheme` for dark mode (do not copy-paste the pattern manually)

## Theme pattern

Use the `useTheme()` hook — it already handles the `data-theme` attribute. Do not implement it inline.

```tsx
const { theme, toggleTheme } = useTheme();
```

Vault note: `hannibal-vault/frontend/src/hooks/useTheme.md`

## Design system

CSS Modules only. Design tokens are CSS custom properties in `src/styles/tokens.css`. Dark mode via `[data-theme="dark"]` on `document.documentElement`.

Vault note: `hannibal-vault/frontend/src/shared/components/atoms/_atoms.md` for all atoms · `hannibal-vault/frontend/src/shared/components/molecules/_molecules.md` for all molecules

## Tests

`backend/tests/` — FastAPI `TestClient` + `pytest-mock`. Services mocked via `app.dependency_overrides`. Never hit the real DB.
