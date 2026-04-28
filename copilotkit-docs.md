# CopilotKit Integration — Project Hannibal

This document is the single source of truth for all CopilotKit work in this repo.
**Read this before touching anything CopilotKit-related.**

---

## Stack context

| Layer | Technology |
|---|---|
| Frontend | React 19 + TypeScript + Vite (no Next.js) |
| Backend | FastAPI + Python 3.14 + `uv` |
| Auth | JWT via `python-jose`, stored in cookies |
| Styling | CSS Modules + `tokens.css` design tokens |
| Runtime URL (local) | `http://localhost:8000/api/v1/copilotkit` |
| Runtime URL (Docker) | `http://backend:8000/api/v1/copilotkit` |

---

## Installed packages

### Frontend (`frontend/package.json`)

```
@copilotkit/react-core   ^1.56.3
@copilotkit/react-ui     ^1.56.3
@copilotkit/runtime      ^1.56.3
```

### Backend (`backend/pyproject.toml`)

```
copilotkit   (add via: uv add copilotkit)   ← not yet installed (issue #21)
```

---

## What is already wired up

### 1. Styles — `frontend/src/main.tsx`

```ts
import '@copilotkit/react-ui/styles.css'   // must be first, before project CSS
```

### 2. Provider — `frontend/src/App.tsx`

```tsx
import { CopilotKit } from "@copilotkit/react-core";

const RUNTIME_URL = import.meta.env.VITE_COPILOTKIT_RUNTIME_URL ?? "/api/v1/copilotkit";

// Tree order: BrowserRouter > AuthProvider > CopilotKit > Routes
<BrowserRouter>
  <AuthProvider>
    <CopilotKit runtimeUrl={RUNTIME_URL}>
      <Routes>...</Routes>
    </CopilotKit>
  </AuthProvider>
</BrowserRouter>
```

`CopilotKit` sits **inside** `AuthProvider` so it has access to the auth context, but **outside** `Routes` so it persists across page navigations.

### 3. Env vars

| Var | `.env` value | `docker-compose.yml` value |
|---|---|---|
| `VITE_COPILOTKIT_RUNTIME_URL` | `http://localhost:8000/api/v1/copilotkit` | `http://backend:8000/api/v1/copilotkit` |
| `GEMINI_API_KEY` | `<your-gemini-api-key>` | `${GEMINI_API_KEY}` |

`VITE_` prefix is required for Vite to expose the var to the browser bundle.


## Key architectural decisions

- `CopilotKit` provider is placed **outside** `Routes` so the chat context survives navigation.
- The runtime URL is configurable via `VITE_COPILOTKIT_RUNTIME_URL` to support both local dev (`localhost:8000`) and Docker (`backend:8000`).
- All backend tools must go through the existing service → repository layer. Never query the DB directly from a tool function.
- The `copilotkit` Python SDK endpoint is mounted at `/copilotkit` under the `/api/v1` prefix, so the full path is `/api/v1/copilotkit` — matching `VITE_COPILOTKIT_RUNTIME_URL`.

---

## Running CopilotKit locally

### Prerequisites

1. Set `GEMINI_API_KEY` in `.env` — required for any backend agent that calls the LLM.
2. Issue #21 must be complete (backend endpoint installed and registered).

### Start the full stack (recommended)

```bash
# From repo root
docker compose up --build
```

Services:
- Frontend → `http://localhost:5173`
- Backend (+ CopilotKit runtime) → `http://localhost:8000`
- CopilotKit endpoint → `http://localhost:8000/api/v1/copilotkit`

### Start services individually (faster iteration)

**Backend:**
```bash
cd backend
uv run python main.py
# server starts at http://localhost:8000
# CopilotKit endpoint: POST http://localhost:8000/api/v1/copilotkit
```

**Frontend:**
```bash
cd frontend
npm run dev
# Vite dev server at http://localhost:5173
# VITE_COPILOTKIT_RUNTIME_URL read from .env automatically
```

### Verify the runtime endpoint is alive

```bash
curl -X POST http://localhost:8000/api/v1/copilotkit \
  -H "Content-Type: application/json" \
  -d '{"thread_id":"test","messages":[]}' \
  --no-buffer
```

A healthy response streams SSE events. A 404 means the router is not registered. A 500 usually means the API key is missing.

### Verify the frontend provider is connected

Open browser DevTools → Network tab → look for a request to `/api/v1/copilotkit` when the chat sidebar opens. It should be a streaming `POST`, not a 4xx.

---

## Maintaining CopilotKit

### Updating frontend packages

All three packages are versioned together — always update them as a group:

```bash
cd frontend
npm install @copilotkit/react-core@latest @copilotkit/react-ui@latest @copilotkit/runtime@latest
npm run build   # verify no type errors before committing
```

After updating, check the [CopilotKit changelog](https://github.com/CopilotKit/CopilotKit/releases) for breaking changes, especially in:
- Import paths (e.g. `@copilotkit/react-core/v2` paths change between majors)
- `CopilotKit` provider prop names
- `useAgent` / `useCopilotReadable` hook signatures

Update the installed version numbers in the **Installed packages** section of this file after every upgrade.

### Updating the backend package

```bash
cd backend
uv add copilotkit   # updates to latest compatible version
uv run pytest       # run tests to catch regressions
```

### Adding a new agent tool (issue #24 pattern)

1. Define the tool function in `backend/app/api/v1/controllers/copilotkit_controller.py`.
2. Pass it to `CopilotKitSDK` or `BuiltInAgent`.
3. Write a unit test that mocks `CopilotKitSDK` — never call the real LLM in tests.
4. Update the **Server-side agent tools** section in this file with the new tool name and what it does.

### Adding a new `useCopilotReadable` context (issue #23 pattern)

1. Add the hook call in the component that owns the relevant state.
2. Keep `description` strings concise — they go into the LLM system prompt verbatim.
3. Update the **Expose app context** section of this file with what is now readable.

### Rotating the LLM API key

1. Update `GEMINI_API_KEY` in `.env`.
2. Restart the backend: `uv run python main.py` (or `docker compose restart backend`).
3. No frontend changes needed — the key never leaves the backend.

### Switching LLM provider

The provider is configured in any LangGraph agent inside `copilotkit_controller.py`.
To switch providers, swap the API key env var in `app/core/config.py`, `.env`, and `docker-compose.yml`,
and update the LangGraph model instantiation in the agent.

---

## Common pitfalls

| Pitfall | Fix |
|---|---|
| CopilotKit styles override project styles | Import `@copilotkit/react-ui/styles.css` **before** project CSS in `main.tsx` |
| SSE streaming times out | Not an issue with FastAPI (only serverless). Docker Compose is fine. |
| `VITE_` prefix missing | Vite strips non-`VITE_` vars from the browser bundle — the provider gets an undefined URL |
| Missing `GEMINI_API_KEY` | Add it to `.env` and restart the backend; the key never leaves the server |
| Tools calling LLM in tests | Always mock `CopilotKitSDK` in tests; use `app.dependency_overrides` |
| Passing auth tokens to `useCopilotReadable` | Never — tokens sent to the LLM are a security risk |
| Updating one CopilotKit package but not others | Always update `react-core`, `react-ui`, and `runtime` together — mismatched versions break the protocol |
| Backend restarts but chat still broken | Clear browser storage / reload — stale thread IDs from a previous session can cause errors |
