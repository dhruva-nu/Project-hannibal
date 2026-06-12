from contextlib import contextmanager
from contextvars import ContextVar
from typing import NotRequired, TypedDict

from copilotkit import CopilotKitState
from langchain_core.messages import AIMessage, SystemMessage
from langchain_core.runnables import RunnableConfig
from langchain_google_genai import ChatGoogleGenerativeAI
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.prebuilt import ToolNode

from app.agent.context_utils import (
    build_context_block,
    extract_course_id,
    extract_lesson_id,
)
from app.agent.prompts.tutor import SYSTEM_PROMPT
from app.agent.tools import all_tools
from app.agent.user_context import build_user_memory
from app.dependencies.db import get_db
from app.repositories.course_repository import CourseRepository
from app.repositories.lesson_repository import LessonRepository


@contextmanager
def _db_session():
    gen = get_db()
    db = next(gen)
    try:
        yield db
    finally:
        gen.close()


active_ck_context: ContextVar[list] = ContextVar("_ck_context", default=[])
active_user_id: ContextVar[int | None] = ContextVar("_user_id", default=None)


class GraphConfig(TypedDict):
    user_id: int


class TutorState(CopilotKitState):
    user_memory: NotRequired[str]
    course_id: NotRequired[int | None]
    course_info: NotRequired[str | None]
    lesson_id: NotRequired[int | None]
    lesson_info: NotRequired[str | None]
    lesson_name: NotRequired[str | None]


_BACKEND_TOOL_NAMES = {t.name for t in all_tools}
_llm: ChatGoogleGenerativeAI | None = None


def _get_llm() -> ChatGoogleGenerativeAI:
    global _llm
    if _llm is None:
        _llm = ChatGoogleGenerativeAI(model="gemini-2.5-flash")
    return _llm


async def context_sync_node(state: TutorState, config: RunnableConfig) -> dict:
    context = active_ck_context.get()
    update: dict = {}

    incoming_course_id = extract_course_id(context)
    if incoming_course_id != state.get("course_id"):
        if incoming_course_id is None:
            update.update({"course_id": None, "course_info": None})
        else:
            with _db_session() as db:
                course = CourseRepository(db).get_by_id(incoming_course_id)
            update.update(
                {
                    "course_id": incoming_course_id,
                    "course_info": course.info if course else None,
                }
            )

    incoming_lesson_id = extract_lesson_id(context)
    if incoming_lesson_id != state.get("lesson_id"):
        if incoming_lesson_id is None:
            update.update({"lesson_id": None, "lesson_name": None, "lesson_info": None})
        else:
            with _db_session() as db:
                lesson = LessonRepository(db).get_by_id(incoming_lesson_id)
            update.update(
                {
                    "lesson_id": incoming_lesson_id,
                    "lesson_name": lesson.name if lesson else None,
                    "lesson_info": lesson.info if lesson else None,
                }
            )

    return update


async def tutor_node(state: TutorState, config: RunnableConfig) -> dict:
    user_mem = state.get("user_memory", "")
    state_update: dict = {}
    if not user_mem:
        uid = (config.get("configurable") or {}).get("user_id") or active_user_id.get()
        if uid is not None:
            with _db_session() as db:
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


def _route_after_tutor(state: TutorState) -> str:
    last = state["messages"][-1] if state.get("messages") else None
    if not isinstance(last, AIMessage) or not last.tool_calls:
        return END
    if any(tc["name"] in _BACKEND_TOOL_NAMES for tc in last.tool_calls):
        return "tools"
    return END


def build_graph():
    graph = StateGraph(TutorState, context_schema=GraphConfig)
    graph.add_node("context_sync", context_sync_node)
    graph.add_node("tutor", tutor_node)
    graph.add_node("tools", ToolNode(all_tools))
    graph.add_edge(START, "context_sync")
    graph.add_edge("context_sync", "tutor")
    graph.add_conditional_edges(
        "tutor", _route_after_tutor, {"tools": "tools", END: END}
    )
    graph.add_edge("tools", "tutor")
    return graph.compile(checkpointer=MemorySaver())
