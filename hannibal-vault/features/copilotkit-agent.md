# CopilotKit Agent

An in-app AI tutor powered by **Google Gemini 2.5 Flash** orchestrated via **LangGraph** and exposed through the **CopilotKit** runtime. Renders as the floating `CopilotPopup` on every page and as the embedded chat on the Home page.

## Architecture

```
React (CopilotKit Provider)                  FastAPI
─────────────────────────                    ────────────────────────────────────────
<CopilotKit                                  add_fastapi_endpoint mounts the
  runtimeUrl="/api/v1/copilotkit">             CopilotKit SDK handler at
  useCopilotNav()  ── navigate_to             /api/v1/copilotkit
  useCopilotReadable({…})                    LangGraphAGUIAgent wraps a compiled
  <CopilotPopup .../>                          LangGraph StateGraph:
</CopilotKit>                                    START → tutor ⇄ tools  (tools_condition)
                                                 checkpointer=MemorySaver
                                                 active_ck_context (set by middleware)
                                                 is injected into the system prompt
                                                 each turn.
```

## Frontend

| File | Lines | Role |
|---|---|---|
| `frontend/src/App.tsx` | 1-13, 23-60 | Wraps the app with `<CopilotKit runtimeUrl="/api/v1/copilotkit">`; `<CopilotShell>` runs `useCopilotNav` so the `navigate_to` frontend action is registered for the whole app; mounts `<CopilotPopup>`. |
| `frontend/src/hooks/useCopilotNav.ts` | — | Registers a CopilotKit frontend action `navigate_to(route)`. Allowed routes: `/home`, `/courses`, `/storyboard`, `/design-board`. Uses React Router's `useNavigate`. |
| `frontend/src/pages/Home/Home.tsx` | 1, 12-23 | Two `useCopilotReadable` calls — page identity + logged-in user. |
| `frontend/src/pages/Courses/Courses.tsx` | 2, after `useTheme` | Page-identity readable for "courses". |
| `frontend/src/pages/CoursePage/CoursePage.tsx` | 3, after `useTheme` | Page-identity readable including `courseId`. |
| `frontend/src/pages/Storyboard/Storyboard.tsx` | 2, after `useTheme` | Page-identity readable for "storyboard". |
| `frontend/src/pages/DesignBoard/DesignBoard.tsx` | 2, after `useTheme` | Page-identity readable for "design-board". |

Runtime URL is configurable via `VITE_COPILOTKIT_RUNTIME_URL` (defaults to `/api/v1/copilotkit`).

## Backend

### Mount — `backend/app/copilotkit_routes.py`

```python
sdk = CopilotKitRemoteEndpoint(agents=[LangGraphAGUIAgent(name="default", graph=...)])
add_fastapi_endpoint(app, sdk, "/api/v1/copilotkit")
```

Also registers `info_router` (explicit `GET`/`POST /info`) and a no-trailing-slash root handler so the JS SDK's REST auto-detect succeeds and POSTs to `/copilotkit` don't 307-redirect.

### Auth + context middleware — `backend/app/middleware.py`

- `auth_copilotkit` — for `POST /api/v1/copilotkit/*`, verifies the `access_token` cookie via JWT decode. Rejects 401 if absent or invalid.
- `capture_copilotkit_context` — peels the request body, grabs the `context` block, and stashes it in a `ContextVar` (`active_ck_context`) so the tutor node can read it on every turn.

### Agent — `backend/app/api/v1/controllers/copilotkit_controller.py`

| Lines | What |
|---|---|
| `TutorState` | TypedDict with `messages: Annotated[..., add_messages]`. Extension point: add `current_topic`, `lesson_id`, etc. as more nodes are introduced. |
| `get_user_profile` | `@tool` — looks up a user by email via `UserRepository.get_by_email`. The LLM may call this when it needs to identify the current user (email comes from the readable context). |
| `tutor_node` | Reads `active_ck_context`, builds a system prompt including any `[Application context]` (page, user, etc.), invokes the bound LLM, returns a single AI message. |
| `_build_graph` | `StateGraph(TutorState)` with `tutor` and `ToolNode(_tools)`; edges `START → tutor`, `tutor →(tools_condition)→ tools | END`, `tools → tutor`. Compiled with `MemorySaver` so each `thread_id` keeps its own history. |
| `sdk = CopilotKitRemoteEndpoint(...)` | Wraps the compiled graph in a single `LangGraphAGUIAgent(name="default")`. |

### Configuration

| Env var | Required | Notes |
|---|---|---|
| `GEMINI_API_KEY` | yes | Google AI Studio key. `ChatGoogleGenerativeAI` reads it at import. |

Model is hardcoded to `gemini-2.5-flash` in `ChatGoogleGenerativeAI(model=...)`. To swap, edit that line.

## Surprises

- **The agent reads the current page through `useCopilotReadable`, not the JWT.** Every page calls `useCopilotReadable` so the agent knows where the user is. The middleware-captured context is the only source the tutor node consults each turn.
- **Conversation memory is per-process, in-memory.** `MemorySaver` keys by `thread_id`. Restart the server and threads are gone. Swap to `SqliteSaver` or `PostgresSaver` for durability — it's a one-line change.
- **Navigation is a frontend action.** `useCopilotNav` registers `navigate_to(route)` via `useCopilotAction`; LangGraph treats it as a tool exposed by the CopilotKit runtime. React Router does the actual route change. Add more frontend actions (open modal, focus element, etc.) the same way.
- **CopilotPopup is mounted at the App root**, outside `<Routes>`, so it persists across navigation.
- **SSE only.** The CopilotKit runtime streams. Any proxy in front (nginx, etc.) needs `proxy_buffering off;` for the route.

## Extending the graph

To add a node (e.g., an intent router or a code-explainer subgraph):

1. Add fields to `TutorState`.
2. Add a node function: `def my_node(state): ...` returning a state update.
3. Register and wire it in `_build_graph`.
4. If it needs new tools, add `@tool`-decorated functions and include them in `_tools` (or bind a separate tool list per node).
