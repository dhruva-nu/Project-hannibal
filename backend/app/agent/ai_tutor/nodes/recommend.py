from langchain_core.messages import AIMessage, ToolMessage

from app.agent.ai_tutor.state import TutorState
from app.agent.tools.course_tools import level_for, recommend_course

_TOOL_NAME = "recommend_course"


async def recommend_node(state: TutorState) -> dict:
    """Execute ``recommend_course`` for each matching tool call on the last AI
    message, injecting an escalating level and the current course id.

    The LLM only chooses the topic; the level and course id are supplied here.
    Escalation is per topic: a new topic restarts the search at level 1
    (current-course lessons) and each repeated call for the same topic widens it
    (related courses → full catalogue), so the tutor can keep calling until it
    finds a match. ``recommend_level`` / ``recommend_topic`` track this per thread.
    """
    last = state["messages"][-1] if state.get("messages") else None
    if not isinstance(last, AIMessage):
        return {}

    count = state.get("recommend_level", 0)
    topic_so_far = state.get("recommend_topic")
    course_id = state.get("course_id")
    messages: list[ToolMessage] = []
    for call in last.tool_calls:
        if call["name"] != _TOOL_NAME:
            continue
        topic = (call.get("args") or {}).get("topic", "")
        if topic != topic_so_far:
            count = 0
            topic_so_far = topic
        result = recommend_course.invoke(
            {"topic": topic, "level": level_for(count), "course_id": course_id}
        )
        messages.append(ToolMessage(content=result, tool_call_id=call["id"]))
        count += 1
    return {
        "messages": messages,
        "recommend_level": count,
        "recommend_topic": topic_so_far,
    }
