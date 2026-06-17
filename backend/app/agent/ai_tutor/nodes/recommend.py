from langchain_core.messages import AIMessage, ToolMessage

from app.agent.ai_tutor.state import TutorState
from app.agent.tools.course_tools import next_level, recommend_course

_TOOL_NAME = "recommend_course"


async def recommend_node(state: TutorState) -> dict:
    """Execute ``recommend_course`` for each matching tool call on the last AI
    message, injecting the difficulty level from ``get_level()``.

    The LLM only chooses the topic; the level is supplied here so the model
    cannot guess it, and it escalates across successive recommendations.
    """
    last = state["messages"][-1] if state.get("messages") else None
    if not isinstance(last, AIMessage):
        return {}

    messages: list[ToolMessage] = []
    for call in last.tool_calls:
        if call["name"] != _TOOL_NAME:
            continue
        topic = (call.get("args") or {}).get("topic", "")
        result = recommend_course.invoke({"topic": topic, "level": next_level()})
        messages.append(ToolMessage(content=result, tool_call_id=call["id"]))
    return {"messages": messages}
