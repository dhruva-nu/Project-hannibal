from copilotkit import LangGraphAGUIAgent

from app.agent.ai_tutor import build_graph

agent = LangGraphAGUIAgent(
    name="default",
    description="Project Hannibal AI tutor powered by LangGraph + Gemini.",
    graph=build_graph(),
)
