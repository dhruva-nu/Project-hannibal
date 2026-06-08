from contextvars import ContextVar

from copilotkit import CopilotKitState, LangGraphAGUIAgent
from langchain_core.messages import AIMessage, SystemMessage
from langchain_core.tools import tool
from langchain_google_genai import ChatGoogleGenerativeAI
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.prebuilt import ToolNode

from app.db.session import SessionLocal
from app.repositories.user_repository import UserRepository

# Populated by the request middleware from the raw body's `context` array so
# the tutor node sees useCopilotReadable / AG-UI Context entries on every turn.
active_ck_context: ContextVar[list] = ContextVar("_ck_context", default=[])


# ── Tools ──────────────────────────────────────────────────────────────────


@tool
def get_user_profile(email: str) -> str:
    """Look up a registered user's profile by their email address."""
    db = SessionLocal()
    try:
        user = UserRepository(db).get_by_email(email)
        if not user:
            return f"No user found with email '{email}'."
        return (
            f"User profile — id: {user.id}, email: {user.email}, "
            f"provider: {user.provider}, member since: {user.created_at.date()}"
        )
    finally:
        db.close()


_tools = [get_user_profile]


# ── Graph ──────────────────────────────────────────────────────────────────


TutorState = CopilotKitState


_SYSTEM_PROMPT = (
    "You are an AI tutor for Project Hannibal, a hands-on platform for learning "
    "to code and design real systems. Help users understand system design concepts, "
    "explain code, and guide them through building real projects. "
    "When the user asks to go to a different page in the app, call the frontend "
    "tool `navigate_to` with the appropriate route."
)

_BACKEND_TOOL_NAMES = {t.name for t in _tools}
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


def tutor_node(state: TutorState) -> dict:
    context = active_ck_context.get() or []
    ctx_block = _build_context_block(context)
    system_text = _SYSTEM_PROMPT
    if ctx_block:
        system_text = f"{_SYSTEM_PROMPT}\n\n[Application context]\n{ctx_block}"

    frontend_tools = (state.get("copilotkit") or {}).get("actions") or []
    llm = _get_llm().bind_tools([*_tools, *frontend_tools])

    response = llm.invoke([SystemMessage(content=system_text), *state["messages"]])
    return {"messages": [response]}


def _route_after_tutor(state: TutorState) -> str:
    last = state["messages"][-1] if state.get("messages") else None
    if not isinstance(last, AIMessage) or not last.tool_calls:
        return END
    if any(tc["name"] in _BACKEND_TOOL_NAMES for tc in last.tool_calls):
        return "tools"
    return END


def _build_graph():
    graph = StateGraph(TutorState)
    graph.add_node("tutor", tutor_node)
    graph.add_node("tools", ToolNode(_tools))
    graph.add_edge(START, "tutor")
    graph.add_conditional_edges(
        "tutor", _route_after_tutor, {"tools": "tools", END: END}
    )
    graph.add_edge("tools", "tutor")
    return graph.compile(checkpointer=MemorySaver())


_compiled_graph = _build_graph()


agent = LangGraphAGUIAgent(
    name="default",
    description="Project Hannibal AI tutor powered by LangGraph + Gemini.",
    graph=_compiled_graph,
)
