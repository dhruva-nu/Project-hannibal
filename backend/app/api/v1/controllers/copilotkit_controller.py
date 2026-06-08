import uuid
from collections.abc import AsyncGenerator
from contextvars import ContextVar

import copilotkit.integrations.fastapi as _ck_fastapi
from ag_ui.core.events import (
    RunFinishedEvent,
    RunStartedEvent,
    StateSnapshotEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    TextMessageStartEvent,
)
from ag_ui.encoder import EventEncoder
from copilotkit import CopilotKitRemoteEndpoint
from copilotkit.action import ActionDict
from copilotkit.agent import Agent
from copilotkit.types import Message
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from google.adk.agents import LlmAgent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.adk.tools import FunctionTool
from google.genai import types as genai_types

from app.db.session import SessionLocal
from app.repositories.user_repository import UserRepository

_ADK_APP_NAME = "hannibal"
_USER_ID = "user"

_session_service = InMemorySessionService()

# ContextVar lets the tool know which thread is currently running so it can
# store per-thread state without coupling it to the function signature.
_active_thread_id: ContextVar[str] = ContextVar("_ck_thread_id", default="")

# Populated by the request middleware from the raw body's `context` array so
# the agent always sees useCopilotReadable data regardless of SDK version.
active_ck_context: ContextVar[list] = ContextVar("_ck_context", default=[])

# Per-thread task list written by the update_tasks tool and flushed as a
# StateSnapshotEvent after each run so the frontend can re-render.
_tasks_by_thread_id: dict[str, list[dict]] = {}


# ── Agent tools ────────────────────────────────────────────────────────────


def _make_get_user_profile(verified_email: str):
    """Return a zero-arg tool function bound to the verified email for this request."""

    def get_user_profile() -> str:
        """Return the profile of the currently authenticated user."""
        db = SessionLocal()
        try:
            user = UserRepository(db).get_by_email(verified_email)
            if not user:
                return "User not found."
            return (
                f"User profile — id: {user.id}, email: {user.email}, "
                f"provider: {user.provider}, member since: {user.created_at.date()}"
            )
        finally:
            db.close()

    return get_user_profile


def _update_tasks_impl(tasks: list) -> dict:
    """Update the task board shown in the UI.

    Each task must be an object with 'title' (str) and 'status'
    ('todo' | 'in_progress' | 'done').
    """
    thread_id = _active_thread_id.get()
    if thread_id:
        _tasks_by_thread_id[thread_id] = [
            {
                "title": str(t.get("title", "")),
                "status": str(t.get("status", "todo")),
            }
            for t in (tasks or [])
        ]
    return {"updated": True, "count": len(tasks or [])}


_TASK_SCHEMA = genai_types.Schema(
    type=genai_types.Type.OBJECT,
    properties={
        "tasks": genai_types.Schema(
            type=genai_types.Type.ARRAY,
            description="List of tasks to display on the task board.",
            items=genai_types.Schema(
                type=genai_types.Type.OBJECT,
                properties={
                    "title": genai_types.Schema(type=genai_types.Type.STRING),
                    "status": genai_types.Schema(
                        type=genai_types.Type.STRING,
                        description="One of: todo, in_progress, done",
                    ),
                },
                required=["title", "status"],
            ),
        )
    },
    required=["tasks"],
)


class _UpdateTasksTool(FunctionTool):
    """FunctionTool wrapper with a hand-crafted declaration to avoid $ref schemas."""

    def __init__(self):
        super().__init__(func=_update_tasks_impl)
        self._name = "update_tasks"
        self._description = (
            "Update the task board shown in the UI. "
            "Each task needs a 'title' (string) and a 'status' "
            "('todo', 'in_progress', or 'done')."
        )

    def _get_declaration(self) -> genai_types.FunctionDeclaration:
        return genai_types.FunctionDeclaration(
            name=self._name,
            description=self._description,
            parameters=_TASK_SCHEMA,
        )


# ── ADK agent & runner ─────────────────────────────────────────────────────

_AGENT_INSTRUCTION = (
    "You are an AI tutor for Project Hannibal, a hands-on platform for learning "
    "to code and design real systems. Help users understand system design concepts, "
    "explain code, and guide them through building real projects. "
    "When a user asks you to add or manage tasks, call update_tasks with the full "
    "updated task list. Each task needs a 'title' and a 'status' "
    "('todo', 'in_progress', or 'done')."
)


def _make_runner(verified_email: str | None) -> Runner:
    """Build an ADK Runner with tools scoped to the authenticated user."""
    tools: list = [_UpdateTasksTool()]
    if verified_email:
        tools.append(FunctionTool(_make_get_user_profile(verified_email)))
    agent = LlmAgent(
        name="hannibal_tutor",
        model="gemini-2.5-flash",
        instruction=_AGENT_INSTRUCTION,
        tools=tools,
    )
    return Runner(
        agent=agent,
        app_name=_ADK_APP_NAME,
        session_service=_session_service,
    )


def _build_context_block(context: list) -> str:
    """Serialize the useCopilotReadable context array into a readable block."""
    if not context:
        return ""
    parts = [
        f"- {item['description']}: {item['value']}"
        for item in context
        if item.get("description")
    ]
    return "\n".join(parts)


def _copilotkit_messages_to_genai(
    messages: list[Message],
    context: list,
) -> genai_types.Content | None:
    """Return the last user message, prefixed with readable context, as a genai Content object."""
    context_block = _build_context_block(context)
    for msg in reversed(messages):
        if msg.get("role") == "user" and msg.get("content"):
            text = msg["content"]
            if context_block:
                text = (
                    f"[Application context]\n{context_block}\n\n[User message]\n{text}"
                )
            return genai_types.Content(
                role="user",
                parts=[genai_types.Part(text=text)],
            )
    return None


async def _stream_adk(
    messages: list[Message],
    thread_id: str,
    context: list,
    runner: Runner,
) -> AsyncGenerator[str, None]:
    active_ck_context.set(context)
    _active_thread_id.set(thread_id)
    encoder = EventEncoder()
    run_id = str(uuid.uuid4())

    yield encoder.encode(RunStartedEvent(thread_id=thread_id, run_id=run_id))

    new_message = _copilotkit_messages_to_genai(messages, context)
    if new_message:
        session = await _session_service.get_session(
            app_name=_ADK_APP_NAME,
            user_id=_USER_ID,
            session_id=thread_id,
        )
        if session is None:
            await _session_service.create_session(
                app_name=_ADK_APP_NAME,
                user_id=_USER_ID,
                session_id=thread_id,
            )

        msg_id = str(uuid.uuid4())
        started = False

        async for event in runner.run_async(
            user_id=_USER_ID,
            session_id=thread_id,
            new_message=new_message,
        ):
            if not event.content or not event.content.parts:
                continue
            for part in event.content.parts:
                text = getattr(part, "text", None)
                if not text:
                    continue
                if not started:
                    yield encoder.encode(
                        TextMessageStartEvent(message_id=msg_id, role="assistant")
                    )
                    started = True
                yield encoder.encode(
                    TextMessageContentEvent(message_id=msg_id, delta=text)
                )

        if started:
            yield encoder.encode(TextMessageEndEvent(message_id=msg_id))

    # Emit agent state so the frontend's useCoAgent can update the task board.
    tasks = _tasks_by_thread_id.get(thread_id, [])
    yield encoder.encode(StateSnapshotEvent(snapshot={"tasks": tasks}))

    yield encoder.encode(RunFinishedEvent(thread_id=thread_id, run_id=run_id))


class GoogleADKAgent(Agent):
    def __init__(self, verified_email: str | None = None):
        super().__init__(
            name="default",
            description="Project Hannibal AI tutor powered by Gemini.",
        )
        self._verified_email = verified_email

    def execute(
        self,
        *,
        state: dict,
        config: dict | None = None,
        messages: list[Message],
        thread_id: str,
        actions: list[ActionDict] | None = None,
        context: list | None = None,
        meta_events=None,
        **kwargs,
    ):
        resolved_context = context or active_ck_context.get()
        runner = _make_runner(self._verified_email)
        return _stream_adk(
            messages=messages,
            thread_id=thread_id,
            context=resolved_context,
            runner=runner,
        )

    async def get_state(self, *, thread_id: str):
        return {
            "threadId": thread_id or "",
            "threadExists": False,
            "state": {"tasks": _tasks_by_thread_id.get(thread_id, [])},
            "messages": [],
        }


def _build_agents(context) -> list:
    email = (context or {}).get("properties", {}).get("userEmail") or None
    return [GoogleADKAgent(verified_email=email)]


sdk = CopilotKitRemoteEndpoint(agents=_build_agents)


def _agents_dict():
    agents = _build_agents({})
    return {
        agent.name: {"description": agent.description or "", "capabilities": None}
        for agent in agents
    }


def _info_response():
    return JSONResponse(
        {
            "version": "0.1.87",
            "agents": _agents_dict(),
            "actions": [],
            "mode": "sse",
            "audioFileTranscriptionEnabled": False,
            "a2uiEnabled": False,
        }
    )


# Patch handle_info so every path (GET /, POST path=info, etc.) returns the
# dict format that JS SDK 1.56+ expects instead of the legacy list format.
async def _patched_handle_info(*, sdk, context, as_html=False):
    return _info_response()


_ck_fastapi.handle_info = _patched_handle_info


# Also expose GET /info explicitly so the JS SDK's REST auto-detect succeeds.
info_router = APIRouter()


@info_router.get("/info")
async def copilotkit_info_get():
    return _info_response()


@info_router.post("/info")
async def copilotkit_info_post():
    return _info_response()
