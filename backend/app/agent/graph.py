from contextvars import ContextVar
from typing import NotRequired, TypedDict

from copilotkit import CopilotKitState
from langchain_core.messages import AIMessage, SystemMessage
from langchain_core.runnables import RunnableConfig
from langchain_google_genai import ChatGoogleGenerativeAI
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.prebuilt import ToolNode

from app.agent.prompts.tutor import SYSTEM_PROMPT
from app.agent.tools import all_tools
from app.agent.user_context import build_user_memory

active_ck_context: ContextVar[list] = ContextVar("_ck_context", default=[])
active_user_id: ContextVar[int | None] = ContextVar("_user_id", default=None)


class GraphConfig(TypedDict):
    user_id: int


class TutorState(CopilotKitState):
    user_memory: NotRequired[str]


_BACKEND_TOOL_NAMES = {t.name for t in all_tools}
_llm: ChatGoogleGenerativeAI | None = None


def _get_llm() -> ChatGoogleGenerativeAI:
    global _llm
    if _llm is None:
        _llm = ChatGoogleGenerativeAI(model="gemini-2.5-flash")
    return _llm


def _build_context_block(context: list) -> str:
    return "\n".join(
        f"- {item['description']}: {item['value']}"
        for item in context
        if item.get("description")
    )


async def tutor_node(state: TutorState, config: RunnableConfig) -> dict:
    user_mem = state.get("user_memory", "")
    state_update: dict = {}
    if not user_mem:
        uid = (config.get("configurable") or {}).get("user_id") or active_user_id.get()
        if uid is not None:
            user_mem = await build_user_memory(uid)
            state_update["user_memory"] = user_mem

    context = active_ck_context.get() or []
    ctx_block = _build_context_block(context)
    system_text = SYSTEM_PROMPT
    if user_mem:
        system_text = f"{system_text}\n\n[User memory]\n{user_mem}"
    if ctx_block:
        system_text = f"{system_text}\n\n[Application context]\n{ctx_block}"

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
    graph = StateGraph(TutorState, config_schema=GraphConfig)
    graph.add_node("tutor", tutor_node)
    graph.add_node("tools", ToolNode(all_tools))
    graph.add_edge(START, "tutor")
    graph.add_conditional_edges(
        "tutor", _route_after_tutor, {"tools": "tools", END: END}
    )
    graph.add_edge("tools", "tutor")
    return graph.compile(checkpointer=MemorySaver())
