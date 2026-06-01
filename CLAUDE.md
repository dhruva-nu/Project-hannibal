# CLAUDE.md

## How to navigate this codebase

**The vault is the primary documentation.** Each file — FE page, FE service, BE controller, service, repository — has its own vault note with its source path and function line numbers. Features are the hub that links them together.

### Vault structure

```
hannibal-vault/
  README.md                          ← start here
  00-architecture.md                 ← system overview
  01-database.md                     ← Postgres + Mongo schema
  features/                          ← end-to-end docs (FE → BE → DB) per feature
    auth.md
    courses-and-lessons.md           ← the core learning loop
    code-execution.md                ← RCE / sandbox
    copilotkit-agent.md              ← Gemini agent
    tags.md
    health.md
  reference/
    frontend-shared.md               ← atoms / molecules / organisms / utils
    frontend-services-api.md         ← api.ts + service modules
    backend-infrastructure.md        ← main, middleware, config, deps
    backend-layers.md                ← controller/service/repository pattern
    pages-supporting.md              ← Home, Storyboard, DesignBoard
```

### Workflow for any task

1. **Open `hannibal-vault/README.md`** — pick the right entry point.
2. **Open the feature doc** (e.g. `features/auth.md`) — end-to-end flow + file paths and line ranges for every layer.
3. **Read only those line ranges** in the actual source. Never read files top-to-bottom.
4. For cross-cutting questions (shared components, app wiring, the controller→service→repo pattern), use `reference/`.

### Example

> Task: "fix the Google OAuth callback"

1. `hannibal-vault/features/auth.md` → "Sign in (Google OAuth)" section names every file and line range involved.
2. Read only those ranges in the source.

---

## Stack

- **Backend**: FastAPI + SQLAlchemy + PostgreSQL + Alembic + JWT (HttpOnly cookies) + bcrypt + Google ADK (Gemini)
- **Frontend**: React 19 + TypeScript + Vite + React Router v6 + CSS Modules
- **Infrastructure**: Docker Compose (Postgres + backend :8000 + frontend :5173)

## Code Quality

Always make sure these are followed

- No function or method will be more than 150 lines
- Names must remove the need for comments
- <1% duplicate code
- 100% test coverage
- Fail loudly and safely

## Layer rules

**Backend** — controllers → services → repositories. Never skip layers.

**Frontend** — pages → organisms → molecules → atoms. Pages call `services/api.ts` for HTTP; never fetch directly in components or context.

## CopilotKit

For any CopilotKit task read **[copilotkit-docs.md](./copilotkit-docs.md)** first. Contains package versions, wiring decisions, and pitfalls.

Current state: `GoogleADKAgent` in `copilotkit_controller.py` wraps Google ADK's `LlmAgent` with Gemini 2.5 Flash. Frontend uses `CopilotPopup` inside `CopilotKit` but outside `Routes`. Requires `GEMINI_API_KEY` in `.env`.

Vault node: `hannibal-vault/backend/copilotkit-controller.md`

## Auth

Tokens are HttpOnly cookies (`access_token` + `refresh_token`). Login sets both; logout clears them. Never use localStorage or Authorization headers.

Vault nodes: `hannibal-vault/frontend/AuthContext.md` · `hannibal-vault/backend/auth-controller.md` · `hannibal-vault/backend/AuthService.md` · `hannibal-vault/frontend/api.md`

## New page checklist (frontend)

1. `src/pages/<Name>/<Name>.tsx` + `<Name>.module.css`
2. Add `<Route>` in `App.tsx`
3. Use `PaperBg` for background
4. Use `useTheme()` from `hooks/useTheme` for dark mode (do not copy-paste the pattern manually)
5. Add a vault node at `hannibal-vault/frontend/<Name>.md` with file path, functions, and `→ Calls` links

## Theme pattern

Use the `useTheme()` hook — it already handles the `data-theme` attribute. Do not implement it inline.

```tsx
const { theme, toggleTheme } = useTheme();
```

## Design system

CSS Modules only. Design tokens are CSS custom properties in `src/styles/tokens.css`. Dark mode via `[data-theme="dark"]` on `document.documentElement`.

Atoms: `frontend/src/shared/components/atoms/`
Molecules: `frontend/src/shared/components/molecules/`

## Tests

`backend/tests/` — FastAPI `TestClient` + `pytest-mock`. Services mocked via `app.dependency_overrides`. Never hit the real DB.
