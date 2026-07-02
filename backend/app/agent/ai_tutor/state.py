from contextvars import ContextVar
from typing import NotRequired, TypedDict

from copilotkit import CopilotKitState

from app.dependencies.db import db_session

__all__ = [
    "GraphConfig",
    "TutorState",
    "active_ck_context",
    "active_user_id",
    "db_session",
]

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
    recommend_level: NotRequired[int]
    recommend_topic: NotRequired[str | None]
