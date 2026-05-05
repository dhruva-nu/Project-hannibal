# copilotkit-controller

**File:** `backend/app/api/v1/controllers/copilotkit_controller.py`  
**Router prefix:** `/api/v1/copilotkit`

## Endpoints

| Method | Path | Function | Lines | Auth |
|--------|------|----------|-------|------|
| `GET` | `/info` | `copilotkit_info_get` | 301–303 | ❌ |
| `POST` | `/info` | `copilotkit_info_post` | 306–308 | ❌ |
| `POST` | `/` (SDK handler) | `sdk.handle_request` | — | ❌ |

## Key symbols

| Symbol | Lines | Purpose |
|--------|-------|---------|
| `get_user_profile(email)` | 51–63 | ADK tool — queries DB for user profile string |
| `_update_tasks_impl(tasks)` | 66–81 | ADK tool — stores task list per thread in memory |
| `_UpdateTasksTool` | 107–124 | Wraps `_update_tasks_impl` with hand-crafted Gemini schema |
| `_adk_agent` | 129–141 | `LlmAgent("gemini-2.5-flash")` with both tools |
| `_runner` | 143–147 | `Runner` with `InMemorySessionService` |
| `_stream_adk` | 176–232 | Async generator — emits SSE events (RunStarted → TextContent → StateSnapshot → RunFinished) |
| `GoogleADKAgent.execute` | 242–255 | CopilotKit `Agent` bridge → calls `_stream_adk` |
| `GoogleADKAgent.get_state` | 257–263 | Returns per-thread task list for `useCoAgent` |

## Calls

→ [[UserRepository]] (direct — `get_user_profile` tool bypasses service layer)

## Notes

Sessions are in-memory (`InMemorySessionService`) — restart clears all thread history.  
Requires `GEMINI_API_KEY` in `.env`.
