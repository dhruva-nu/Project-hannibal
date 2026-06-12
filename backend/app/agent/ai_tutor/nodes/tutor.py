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

_BACKEND_TOOL_NAMES = {t.name for t in all_tools}
_llm: ChatGoogleGenerativeAI | None = None


def _get_llm() -> ChatGoogleGenerativeAI:
    global _llm
    if _llm is None:
        _llm = ChatGoogleGenerativeAI(model="gemini-2.5-flash")
    return _llm


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
    llm = _get_llm().bind_tools([*all_tools, *frontend_tools])

    response = await llm.ainvoke(
        [SystemMessage(content=system_text), *state["messages"]]
    )
    return {"messages": [response], **state_update}


def route_after_tutor(state: TutorState) -> str:
    last = state["messages"][-1] if state.get("messages") else None
    if not isinstance(last, AIMessage) or not last.tool_calls:
        return END
    if any(tc["name"] in _BACKEND_TOOL_NAMES for tc in last.tool_calls):
        return "tools"
    return END
