import os
from contextlib import contextmanager

from langchain_core.messages import AIMessage, SystemMessage
from langchain_core.runnables import RunnableConfig
from langchain_google_genai import ChatGoogleGenerativeAI
from langgraph.graph import END

from app.agent.ai_tutor.context_utils import build_context_block
from app.agent.ai_tutor.state import (
    TutorState,
    active_ck_context,
    active_user_id,
    db_session,
)
from app.agent.prompts.tutor import SYSTEM_PROMPT
from app.agent.tools import all_tools
from app.agent.user_context import build_user_memory
from app.core.config import settings

_MODEL = "gemini-2.5-flash"
_VERTEX = "vertex"
_GEMINI = "gemini"
_BACKEND_TOOL_NAMES = {t.name for t in all_tools}
_vertex_llm: ChatGoogleGenerativeAI | None = None
_gemini_llm: ChatGoogleGenerativeAI | None = None


@contextmanager
def _google_api_key(key: str):
    """Force ``GOOGLE_API_KEY`` while a client is built.

    Vertex express mode resolves its key from ``GOOGLE_API_KEY``, which
    google-genai prefers over ``GEMINI_API_KEY``. Without this the Gemini
    developer key in the env leaks into the Vertex client and it 401s.
    The key is read and cached at construction, so we restore the env after.
    """
    previous = os.environ.get("GOOGLE_API_KEY")
    os.environ["GOOGLE_API_KEY"] = key
    try:
        yield
    finally:
        if previous is None:
            os.environ.pop("GOOGLE_API_KEY", None)
        else:
            os.environ["GOOGLE_API_KEY"] = previous


def _get_vertex_llm() -> ChatGoogleGenerativeAI | None:
    global _vertex_llm
    if _vertex_llm is None and settings.vertex_ai_key:
        with _google_api_key(settings.vertex_ai_key):
            _vertex_llm = ChatGoogleGenerativeAI(
                model=_MODEL,
                vertexai=True,
                google_api_key=settings.vertex_ai_key,
            )
    return _vertex_llm


def _get_gemini_llm() -> ChatGoogleGenerativeAI | None:
    global _gemini_llm
    if _gemini_llm is None and settings.gemini_api_key:
        _gemini_llm = ChatGoogleGenerativeAI(
            model=_MODEL,
            google_api_key=settings.gemini_api_key,
        )
    return _gemini_llm


def _bind_tools(tools: list):
    """Bind tools to the ``LLM_PROVIDER`` default, falling back to the other."""
    if settings.llm_provider not in (_VERTEX, _GEMINI):
        raise RuntimeError(
            f"LLM_PROVIDER must be '{_VERTEX}' or '{_GEMINI}', got "
            f"'{settings.llm_provider}'."
        )
    if settings.llm_provider == _GEMINI:
        primary, fallback = _get_gemini_llm(), _get_vertex_llm()
    else:
        primary, fallback = _get_vertex_llm(), _get_gemini_llm()
    if primary is None and fallback is None:
        raise RuntimeError("Neither VERTEX_AI_KEY nor GEMINI_API_KEY is configured.")
    if primary is None:
        return fallback.bind_tools(tools)
    if fallback is None:
        return primary.bind_tools(tools)
    return primary.bind_tools(tools).with_fallbacks([fallback.bind_tools(tools)])


def _flatten_text_content(content: object) -> str:
    """Collapse multi-part LLM content into a single string.

    Gemini aggregates a streamed answer into ``content`` as a mixed list: the
    first chunk arrives as a ``{"type": "text", "text": ...}`` dict and every
    later chunk merges in as a bare string. The AG-UI snapshot serializer keeps
    only the first ``text`` dict, so the end-of-run snapshot replaces a long
    streamed answer with a truncated copy. Joining every textual part (bare
    strings and ``text`` dicts) here stores the full answer as a plain string,
    which round-trips through the snapshot intact.
    """
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for part in content:
            if isinstance(part, str):
                parts.append(part)
            elif isinstance(part, dict) and part.get("type") == "text":
                parts.append(part.get("text") or "")
        return "".join(parts)
    return str(content)


async def tutor_node(state: TutorState, config: RunnableConfig) -> dict:
    user_mem = state.get("user_memory", "")
    state_update: dict = {}
    if not user_mem:
        uid = (config.get("configurable") or {}).get("user_id") or active_user_id.get()
        if uid is not None:
            with db_session() as db:
                user_mem = await build_user_memory(uid, db)
            state_update["user_memory"] = user_mem

    context = active_ck_context.get()
    ctx_block = build_context_block(context)
    system_text = SYSTEM_PROMPT
    if user_mem:
        system_text = f"{system_text}\n\n[User memory]\n{user_mem}"
    if ctx_block:
        system_text = f"{system_text}\n\n[Application context]\n{ctx_block}"
    course_info = state.get("course_info")
    if course_info:
        system_text = f"{system_text}\n\n[Course reference material]\n{course_info}"
    lesson_name = state.get("lesson_name")
    lesson_info = state.get("lesson_info")
    if lesson_name:
        system_text = f"{system_text}\n\n[Current lesson: {lesson_name}]"
    if lesson_info:
        system_text = f"{system_text}\n{lesson_info}"

    frontend_tools = (state.get("copilotkit") or {}).get("actions") or []
    llm = _bind_tools([*all_tools, *frontend_tools])

    response = await llm.ainvoke(
        [SystemMessage(content=system_text), *state["messages"]]
    )
    response.content = _flatten_text_content(response.content)
    return {"messages": [response], **state_update}


def route_after_tutor(state: TutorState) -> str:
    last = state["messages"][-1] if state.get("messages") else None
    if not isinstance(last, AIMessage) or not last.tool_calls:
        return END
    if any(tc["name"] in _BACKEND_TOOL_NAMES for tc in last.tool_calls):
        return "tools"
    return END
