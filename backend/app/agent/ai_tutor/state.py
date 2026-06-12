from contextlib import contextmanager
from contextvars import ContextVar
from typing import NotRequired, TypedDict

from copilotkit import CopilotKitState

from app.dependencies.db import get_db

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


@contextmanager
def db_session():
    gen = get_db()
    db = next(gen)
    try:
        yield db
    finally:
        gen.close()
