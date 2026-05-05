# CLAUDE.md

## How to navigate this codebase

**The vault is the primary documentation.** Each file — FE page, FE service, BE controller, service, repository — has its own vault note with its source path and function line numbers. Features are the hub that links them together.

### Vault structure

```
hannibal-vault/
  00 - Features Index.md      ← start here
  features/
    auth.md                   ← feature hub (overview + node list)
    courses.md
    lessons.md
    tags.md
    rce.md
    copilotkit.md
    health.md
    auth-flow.canvas          ← visual swimlane diagram (open in Obsidian)
    courses-flow.canvas
    lessons-flow.canvas
    rce-flow.canvas
    copilotkit-flow.canvas
  frontend/
    Login.md                  ← individual file nodes
    AuthContext.md
    api.md
    Courses.md
    courses-service.md
    CoursePage.md
    useCourseState.md
    courseDetail-service.md
  backend/
    auth-controller.md        ← individual file nodes
    AuthService.md
    UserRepository.md
    RefreshTokenRepository.md
    course-controller.md
    CourseService.md
    CourseRepository.md
    lesson-controller.md
    LessonService.md
    LessonRepository.md
    tags-controller.md
    TagsService.md
    TagsRepository.md
    rce-controller.md
    rce-service.md
    copilotkit-controller.md
    health-controller.md
    HealthService.md
    HealthRepository.md
```

### Workflow for any task

1. **Open `hannibal-vault/00 - Features Index.md`** — find the feature.
2. **Open the feature hub** (e.g. `features/auth.md`) — see the data flow chain and all nodes involved.
3. **Open the specific node** (e.g. `backend/AuthService.md`) — get the exact file path and line numbers.
4. **Read only those lines** in the actual source file. Never read files top-to-bottom.
5. **Follow `→ Calls` links** in node notes to traverse dependencies (e.g. service → repository).

### Example

> Task: "fix the Google OAuth callback"

1. `hannibal-vault/features/auth.md` → see the flow, note nodes involved
2. `hannibal-vault/backend/auth-controller.md` → `google_callback` lines 132–155
3. `hannibal-vault/backend/AuthService.md` → `handle_google_callback` lines 113–151
4. Read only those ranges in the source

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
