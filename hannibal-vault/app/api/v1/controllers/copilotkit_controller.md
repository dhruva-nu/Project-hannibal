---
name: copilotkit_controller.py
description: CopilotKit SSE endpoint — wraps Google ADK LlmAgent (Gemini 2.5 Flash) with agent tools and streaming
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
- A **streaming runner** that drives the Google ADK agent and emits AG-UI events
- The `GoogleADKAgent` class that wraps everything in a CopilotKit `Agent` interface
- `/info` route handlers so the JS SDK can auto-detect the endpoint

**Imports:** [[app/core/config]] · [[app/db/session]] · [[app/repositories/user_repository]]

---

## `get_user_profile` (agent tool) — lines 46–58

LLM-callable tool. Takes an email address, queries [[app/repositories/user_repository#get_by_email]], and returns the user's profile as a formatted string (or a "not found" message). Uses its own DB session that it opens and closes directly.

**Calls:** [[app/repositories/user_repository#get_by_email]]

---

## `update_tasks` (agent tool) — lines 61–76

LLM-callable tool. Accepts a list of `{title, status}` task objects and stores them in `_tasks_by_thread_id` keyed by the current thread ID (read from `_active_thread_id` ContextVar). The stored tasks are later flushed as a `StateSnapshotEvent` so the frontend task board updates.

---

## `_stream_adk` — lines 113–167

Core streaming coroutine. For a given `messages` list and `thread_id`:
1. Emits a `RunStartedEvent`
2. Converts the last user message to a `genai.Content` object
3. Ensures an ADK session exists for the thread
4. Drives `_runner.run_async(...)` and yields `TextMessage*` events for each text chunk
5. After the run, emits a `StateSnapshotEvent` with the current task list
6. Emits `RunFinishedEvent`

**Calls:** `_copilotkit_messages_to_genai` · [[app/repositories/user_repository]] (indirectly via `get_user_profile` tool)

---

## `GoogleADKAgent.execute` — lines 177–188

The CopilotKit `Agent` interface method. Called by the CopilotKit SDK for each incoming chat turn. Delegates entirely to `_stream_adk`, passing the messages and thread ID.

**Calls:** `_stream_adk`

---

## `GoogleADKAgent.get_state` — lines 190–196

Returns the current agent state for a thread: the task list from `_tasks_by_thread_id`. Called by the CopilotKit SDK when the frontend polls for state.

---

## `copilotkit_info_get` / `copilotkit_info_post` — lines 234–241

`GET /api/v1/copilotkit/info` and `POST /api/v1/copilotkit/info`

Return a JSON info object describing the registered agents and SDK version. Required by the CopilotKit JS SDK's REST auto-detect flow.
