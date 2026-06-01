# CopilotKit Agent

An in-app AI sidekick powered by **Google Gemini 2.5 Flash** through **Google ADK** (Agent Development Kit), exposed via the **CopilotKit** runtime. Renders as the floating `CopilotPopup` on every authenticated page and as the embedded chat on the Home page.

## Architecture

```
React (CopilotKit Provider)                  FastAPI
─────────────────────────                    ────────────────────────────────────────
<CopilotKit                                  copilotkit_routes.add_fastapi_endpoint
  runtimeUrl="/api/v1/copilotkit">             mounts the CopilotKit SDK handler
  <CopilotPopup .../>                            at /api/v1/copilotkit
  useCopilotReadable({…})                        registers GoogleADKAgent as the agent
  useCoAgent({name, state})              ─────►   each chat turn:
</CopilotKit>                                       _stream_adk converts CopilotKit messages
                                                    to genai Content, runs via ADK Runner,
                                                    yields ag_ui events back over SSE
```

## Frontend

| File | Lines | Role |
|---|---|---|
| `frontend/src/App.tsx` | 3-4, 26, 44-49 | Wraps the app with `<CopilotKit runtimeUrl="/api/v1/copilotkit">`; mounts `<CopilotPopup label="Hannibal AI" />`. |
| `frontend/src/pages/Home/Home.tsx` | 1, 19-32 | Uses `useCopilotReadable()` twice (page context + user info) so the agent has grounding; uses `useCoAgent()` to mirror agent task-state into the UI. |
| `frontend/src/pages/Home/HeroRight.tsx` | — | Renders the live agent-side task list passed down from `Home`. |

Runtime URL is configurable via `VITE_COPILOTKIT_RUNTIME_URL` (defaults to `/api/v1/copilotkit`).

## Backend

### Mount — `backend/app/copilotkit_routes.py:8-24`

```python
sdk = CopilotKitRemoteEndpoint(agents=[GoogleADKAgent()])
add_fastapi_endpoint(app, sdk, "/api/v1/copilotkit")
```

The CopilotKit SDK adds the message/event endpoints under that prefix.

### Auth + context middleware — `backend/app/middleware.py`

Two pieces guard the CopilotKit endpoint:

- `auth_copilotkit` — for `POST /api/v1/copilotkit/*`, reads the `access_token` cookie and verifies it via `AuthService.verify_token`. Rejects 401 if absent or invalid.
- `capture_copilotkit_context` — peels the request body, grabs the `context` block, and stashes it in `contextvars` so the agent can look up which user / page the message came from.

### Agent — `backend/app/api/v1/controllers/copilotkit_controller.py`

| Lines | What |
|---|---|
| `129-141` | Builds the ADK `LlmAgent` with model `gemini-2.5-flash` and two tools: `get_user_profile`, `_UpdateTasksTool`. |
| `51-63` | **Tool `get_user_profile`** — looks up the current user via `UserRepository.get_by_email` (email from captured context), returns a formatted string. |
| `66-81` (impl) `107-124` (schema) | **Tool `update_tasks`** — accepts a list `[{title, status: "todo" | "in_progress" | "done"}, …]`; caches per-thread; the result is emitted to the FE as a `StateSnapshotEvent` so `useCoAgent` re-renders. |
| `182-238` | **`_stream_adk`** — converts CopilotKit's message format into `genai.types.Content`, runs the agent via ADK `Runner`, and yields ag_ui events: `RunStartedEvent`, `TextMessageStartEvent`/`ContentEvent`/`EndEvent`, `StateSnapshotEvent`, `RunFinishedEvent`. |
| `241-272` | **`GoogleADKAgent`** — implements CopilotKit's `Agent` protocol; `info()` returns metadata, `run()` calls `_stream_adk`. |

### Configuration

| Env var | Required | Notes |
|---|---|---|
| `GEMINI_API_KEY` | yes | Google AI Studio key. Server fails to start the agent without it. |

Model is hardcoded to `gemini-2.5-flash`. To swap models, edit the `LlmAgent(model=...)` line at `copilotkit_controller.py:129-141`.

## Surprises

- **The agent reads the current user.** It does this through the middleware-captured context, *not* through the JWT directly. If you change the middleware, `get_user_profile` breaks.
- **Tasks are per-thread, in-memory.** `update_tasks` caches the latest list keyed by thread id. Restart the server and the list is gone. Persist it if you need durability — there's no DB-backed schema for it today.
- **CopilotPopup is mounted at the App root**, outside `<Routes>`. It exists on every page even though the readable context only fires on Home today. Other pages can call `useCopilotReadable` to enrich the agent's view without re-mounting anything.
- **SSE only.** The CopilotKit runtime is streaming-first. Any proxy in front (nginx, etc.) needs `proxy_buffering off;` for the route.
