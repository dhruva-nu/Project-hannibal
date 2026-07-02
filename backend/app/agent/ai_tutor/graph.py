from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.prebuilt import ToolNode

from app.agent.ai_tutor.nodes.context_sync import context_sync_node
from app.agent.ai_tutor.nodes.recommend import recommend_node
from app.agent.ai_tutor.nodes.tutor import route_after_tutor, tutor_node
from app.agent.ai_tutor.state import GraphConfig, TutorState
from app.agent.tools import all_tools


def build_graph():
    graph = StateGraph(TutorState, context_schema=GraphConfig)
    graph.add_node("context_sync", context_sync_node)
    graph.add_node("tutor", tutor_node)
    graph.add_node("tools", ToolNode(all_tools))
    graph.add_node("recommend", recommend_node)
    graph.add_edge(START, "context_sync")
    graph.add_edge("context_sync", "tutor")
    graph.add_conditional_edges(
        "tutor",
        route_after_tutor,
        {"tools": "tools", "recommend": "recommend", END: END},
    )
    graph.add_edge("tools", "tutor")
    graph.add_edge("recommend", "tutor")
    return graph.compile(checkpointer=MemorySaver())
