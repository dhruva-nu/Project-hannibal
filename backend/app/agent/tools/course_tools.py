from collections.abc import Iterator

from langchain_core.tools import tool
from sqlalchemy.orm import Session

from app.dependencies.db import db_session
from app.repositories.course_repository import CourseRepository
from app.repositories.lesson_repository import LessonRepository

_WIDEST_LEVEL = 3


def recommended_level_generator() -> Iterator[int]:
    """Yield escalating recommendation tiers for out-of-scope questions.

    The first ask surfaces the current course's lessons (1), the next its
    related courses (2), and any further ask the full catalogue (3).
    """
    yield 1
    yield 2
    while True:
        yield 3


def level_for(call_index: int) -> int:
    """Resolve the recommendation tier for the nth ask in a conversation.

    ``call_index`` is 0-based, so the first recommendation is level 1.
    """
    gen = recommended_level_generator()
    level = next(gen)
    for _ in range(call_index):
        level = next(gen)
    return level


def _current_course_learnings(db: Session, course_id: int | None) -> str:
    if course_id is None:
        return "No course is currently open, so I can't list its lessons."
    lessons = LessonRepository(db).get_by_course(course_id)
    if not lessons:
        return "This course has no lessons yet."
    return "\n".join(f"- {lesson.name}: {lesson.learning}" for lesson in lessons)


def _related_course_descriptions(db: Session, course_id: int | None) -> str:
    if course_id is None:
        return "No course is currently open, so I can't find related courses."
    courses = CourseRepository(db).get_related_courses(course_id)
    if not courses:
        return "No related courses are available for this course."
    return "\n".join(f"- {course.name}: {course.description}" for course in courses)


def _all_course_descriptions(db: Session) -> str:
    courses = CourseRepository(db).get_all()
    if not courses:
        return "There are no courses in the catalogue yet."
    return "\n".join(f"- {course.name}: {course.description}" for course in courses)


@tool
def recommend_course(topic: str, level: int, course_id: int | None) -> str:
    """Recommend learning material when the user asks about something outside
    the scope of their current lesson.

    ``level`` and ``course_id`` are supplied by the recommend node — the LLM
    only chooses ``topic`` and must never invent the level or course id. The
    level selects the source: 1 = the current course's lessons, 2 = related
    courses, 3 = the full course catalogue.
    """
    with db_session() as db:
        if level <= 1:
            body = _current_course_learnings(db, course_id)
        elif level == 2:
            body = _related_course_descriptions(db, course_id)
        else:
            body = _all_course_descriptions(db)
    header = f"Recommendation for '{topic}' (level {level}):"
    if level >= _WIDEST_LEVEL:
        footer = (
            "\n(This is the full course catalogue — the widest possible search. "
            "Pick the best match, or tell the user nothing covers it. Do not call "
            "recommend_course again for this topic.)"
        )
    else:
        footer = (
            "\n(If none of these match the topic, call recommend_course again for "
            "this topic to widen the search.)"
        )
    return f"{header}\n{body}{footer}"
