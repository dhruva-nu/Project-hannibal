from typing import Annotated

from langchain_core.tools import tool
from langgraph.prebuilt import InjectedState
from sqlalchemy.orm import Session

from app.dependencies.db import db_session
from app.repositories.course_repository import CourseRepository
from app.repositories.lesson_repository import LessonRepository
from app.services.course_service import CourseService
from app.services.lesson_service import LessonService


def _ensure_course_exists(db: Session, course_id: int) -> None:
    """Raise ``ValueError`` if no course matches ``course_id``.

    Surfaces a bad course id (e.g. stale application context) loudly instead of
    silently returning empty recommendations. ``get_course`` raises for us.
    """
    CourseService(repository=CourseRepository(db=db)).get_course(course_id)


def _lesson_recommendations(db: Session, course_id: int) -> list[str]:
    """Level 1: the learning outcomes of the course's own lessons."""
    service = LessonService(repository=LessonRepository(db=db))
    return [lesson.learning for lesson in service.list_by_course(course_id)]


def _related_course_recommendations(db: Session, course_id: int) -> list[str]:
    """Level 2: descriptions of courses directly related to this one."""
    service = CourseService(repository=CourseRepository(db=db))
    related = service.get_related_courses(course_id)
    related_ids = [c.relatedCourseId for c in related]
    return [course.description for course in service.get_courses(related_ids)]


def _broad_recommendations(db: Session) -> list[str]:
    """Level 3: broader catalogue recommendations (placeholder)."""
    return ["C1", "C2"]


_NO_COURSE = "No active course in context; cannot recommend related material."
_NO_RESULTS = "No related material found for this course yet."


@tool
def recommend_course(topic: str, state: Annotated[dict, InjectedState]) -> str:
    """Surface course material for a topic outside the learner's current lesson.

    Call this in the background whenever the learner asks about something their
    current course does not cover. Keep answering their question normally — this
    call lets the platform point them to the course that covers ``topic``.

    Walks escalating recommendation levels for the active course and returns the
    first that produces results:

    - Level 1: learning outcomes of the lessons within the course itself.
    - Level 2: descriptions of courses directly related to it.
    - Level 3: broader course recommendations.

    Args:
        topic: the subject the learner asked about (e.g. "message queues").

    Note:
        ``course_id`` is injected from application context (``InjectedState``),
        not chosen by the model, so ``topic`` is only the learner-facing signal.
    """
    course_id = state.get("course_id")
    if course_id is None:
        return _NO_COURSE

    with db_session() as db:
        _ensure_course_exists(db, course_id)

        lessons = _lesson_recommendations(db, course_id)
        if lessons:
            return "\n".join(lessons)

        related = _related_course_recommendations(db, course_id)
        if related:
            return "\n".join(related)

        broad = _broad_recommendations(db)
        return "\n".join(broad) if broad else _NO_RESULTS
