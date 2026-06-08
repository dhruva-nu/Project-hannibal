from ag_ui_langgraph import add_langgraph_fastapi_endpoint
from fastapi import FastAPI

from app.api.v1.controllers.copilotkit_controller import agent
from app.core.config import settings


def register_copilotkit(app: FastAPI) -> None:
    add_langgraph_fastapi_endpoint(
        app=app,
        agent=agent,
        path=f"{settings.api_prefix}/copilotkit",
    )
