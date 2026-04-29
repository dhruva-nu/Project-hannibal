---
name: copilotkit_controller.py
description: CopilotKit SSE endpoint — wraps Google ADK LlmAgent (Gemini 2.5 Flash) with agent tools, context injection, and streaming
type: file
layer: api
tags: [controller, copilotkit, agent, gemini, adk, streaming]
imports:
  - "[[app/core/config]]"
  - "[[app/db/session]]"
  - "[[app/repositories/user_repository]]"
---

# `app/api/v1/controllers/copilotkit_controller.py`

Implements the AI chat backend. Exposes a CopilotKit-compatible SSE endpoint at `/api/v1/copilotkit`. Contains:
- Two **agent tools** callable by the LLM (`get_user_profile`, `update_tasks`)
- Context injection: `useCopilotReadable` data is captured by middleware and forwarded to the ADK agent
- A **streaming runner** that drives the Google ADK agent and emits AG-UI events
- The `GoogleADKAgent` class that wraps everything in a CopilotKit `Agent` interface
- `/info` route handlers so the JS SDK can auto-detect the endpoint

**Exports:** `sdk`, `info_router`, `active_ck_context`

**Imports:** [[app/core/config]] · [[app/db/session]] · [[app/repositories/user_repository]]

---

## ContextVars

| Name | Default | Purpose |
|---|---|---|
| `_active_thread_id` | `""` | Current thread ID, set per-request so tools can key per-thread state |
| `active_ck_context` | `[]` | `useCopilotReadable` context array, populated by `capture_copilotkit_context` middleware in `main.py` and read by `_stream_adk` |

---

## `get_user_profile` (agent tool) — lines 51–63

LLM-callable tool. Takes an email address, queries [[app/repositories/user_repository#get_by_email]], and returns the user's profile as a formatted string (or a "not found" message).

**Calls:** [[app/repositories/user_repository#get_by_email]]

---

## `_update_tasks_impl` / `_UpdateTasksTool` — lines 66–124

LLM-callable tool. Accepts a list of `{title, status}` task objects and stores them in `_tasks_by_thread_id` keyed by the current thread ID. Uses a hand-crafted `FunctionDeclaration` to avoid `$ref` schema issues with the ADK SDK. The stored tasks are flushed as a `StateSnapshotEvent` so the frontend task board updates.

---

## `_build_context_block` — lines 150–155

Serializes the `useCopilotReadable` context array (list of `{description, value}` dicts) into a human-readable bullet list for injection into the ADK prompt.

---

## `_copilotkit_messages_to_genai` — lines 158–173

Extracts the last `role: "user"` message from the CopilotKit messages list and returns it as a `genai.Content` object. If a context block is present, prepends it as `[Application context]` so the ADK agent sees `useCopilotReadable` data (user email, page info, etc.) alongside the user message.

**Note:** CopilotKit sends readable context in a separate `context` array in the request body, not as messages — this is why the middleware + ContextVar pattern is used rather than scanning message roles.

---

## `_stream_adk` — lines 176–228

Core streaming coroutine. For a given `messages` list, `thread_id`, and `context`:
1. Sets `active_ck_context` and `_active_thread_id` ContextVars
2. Emits a `RunStartedEvent`
3. Converts the last user message (with context prepended) to a `genai.Content` object
4. Ensures an ADK session exists for the thread
5. Drives `_runner.run_async(...)` and yields `TextMessage*` events for each text chunk
6. After the run, emits a `StateSnapshotEvent` with the current task list
7. Emits `RunFinishedEvent`

**Calls:** `_copilotkit_messages_to_genai` · [[app/repositories/user_repository]] (indirectly via `get_user_profile` tool)

---

## `GoogleADKAgent.execute` — lines 242–256

The CopilotKit `Agent` interface method. Called by the CopilotKit SDK for each incoming chat turn. Resolves context from the `context` parameter (if the SDK passes it) or falls back to `active_ck_context.get()` (populated by middleware). Delegates to `_stream_adk`.

**Calls:** `_stream_adk`

---

## `GoogleADKAgent.get_state` — lines 257–264

Returns the current agent state for a thread: the task list from `_tasks_by_thread_id`. Called by the CopilotKit SDK when the frontend polls for state.

---

## `copilotkit_info_get` / `copilotkit_info_post` — lines 302–308

`GET /api/v1/copilotkit/info` and `POST /api/v1/copilotkit/info`

Return a JSON info object describing the registered agents and SDK version. Required by the CopilotKit JS SDK's REST auto-detect flow.
