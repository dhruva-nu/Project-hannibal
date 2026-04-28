import uuid
from typing import AsyncGenerator, List, Optional

from fastapi import APIRouter
from fastapi.responses import JSONResponse
import copilotkit.integrations.fastapi as _ck_fastapi
from copilotkit import CopilotKitRemoteEndpoint
from copilotkit.agent import Agent
from copilotkit.types import Message
from copilotkit.action import ActionDict
from ag_ui.core.events import (
    EventType,
    RunStartedEvent,
    RunFinishedEvent,
    TextMessageStartEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
)
from ag_ui.encoder import EventEncoder
from google.adk.agents import LlmAgent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types as genai_types

from app.core.config import settings

_APP_NAME = "hannibal"
_USER_ID = "user"

_session_service = InMemorySessionService()

_adk_agent = LlmAgent(
    name="hannibal_tutor",
    model="gemini-2.5-flash",
    instruction=(
        "You are an AI tutor for Project Hannibal, a hands-on platform for learning "
        "to code and design real systems. Help users understand system design concepts, "
        "explain code, and guide them through building real projects."
    ),
)

_runner = Runner(
    agent=_adk_agent,
    app_name=_APP_NAME,
    session_service=_session_service,
)


def _copilotkit_messages_to_genai(messages: List[Message]) -> Optional[genai_types.Content]:
    """Return the last user message as a genai Content object."""
    for msg in reversed(messages):
        if msg.get("role") == "user" and msg.get("content"):
            return genai_types.Content(
                role="user",
                parts=[genai_types.Part(text=msg["content"])],
            )
    return None


async def _stream_adk(
    messages: List[Message],
    thread_id: str,
) -> AsyncGenerator[str, None]:
    encoder = EventEncoder()
    run_id = str(uuid.uuid4())

    yield encoder.encode(RunStartedEvent(thread_id=thread_id, run_id=run_id))

    new_message = _copilotkit_messages_to_genai(messages)
    if new_message:
        session = await _session_service.get_session(
            app_name=_APP_NAME,
            user_id=_USER_ID,
            session_id=thread_id,
        )
        if session is None:
            await _session_service.create_session(
                app_name=_APP_NAME,
                user_id=_USER_ID,
                session_id=thread_id,
            )

        msg_id = str(uuid.uuid4())
        started = False

        async for event in _runner.run_async(
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

    yield encoder.encode(RunFinishedEvent(thread_id=thread_id, run_id=run_id))


class GoogleADKAgent(Agent):
    def __init__(self):
        super().__init__(
            name="default",
            description="Project Hannibal AI tutor powered by Gemini.",
        )

    def execute(
        self,
        *,
        state: dict,
        config: Optional[dict] = None,
        messages: List[Message],
        thread_id: str,
        actions: Optional[List[ActionDict]] = None,
        meta_events=None,
        **kwargs,
    ):
        return _stream_adk(messages=messages, thread_id=thread_id)

    async def get_state(self, *, thread_id: str):
        return {
            "threadId": thread_id or "",
            "threadExists": False,
            "state": {},
            "messages": [],
        }


sdk = CopilotKitRemoteEndpoint(agents=[GoogleADKAgent()])


def _agents_dict():
    agents = sdk.agents if not callable(sdk.agents) else sdk.agents({})
    return {
        agent.name: {"description": agent.description or "", "capabilities": None}
        for agent in agents
    }


def _info_response():
    return JSONResponse({
        "version": "0.1.87",
        "agents": _agents_dict(),
        "actions": [],
        "mode": "sse",
        "audioFileTranscriptionEnabled": False,
        "a2uiEnabled": False,
    })


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
