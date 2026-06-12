from langchain_core.runnables import RunnableConfig

from app.agent.ai_tutor.context_utils import extract_course_id, extract_lesson_id
from app.agent.ai_tutor.state import TutorState, active_ck_context, db_session
from app.repositories.course_repository import CourseRepository
from app.repositories.lesson_repository import LessonRepository


async def context_sync_node(state: TutorState, config: RunnableConfig) -> dict:
    context = active_ck_context.get()
    update: dict = {}

    incoming_course_id = extract_course_id(context)
    if incoming_course_id != state.get("course_id"):
        if incoming_course_id is None:
            update.update({"course_id": None, "course_info": None})
        else:
            with db_session() as db:
                course = CourseRepository(db).get_by_id(incoming_course_id)
            update.update(
                {
                    "course_id": incoming_course_id,
                    "course_info": course.info if course else None,
                }
            )

    incoming_lesson_id = extract_lesson_id(context)
    if incoming_lesson_id != state.get("lesson_id"):
        if incoming_lesson_id is None:
            update.update({"lesson_id": None, "lesson_name": None, "lesson_info": None})
        else:
            with db_session() as db:
                lesson = LessonRepository(db).get_by_id(incoming_lesson_id)
            update.update(
                {
                    "lesson_id": incoming_lesson_id,
                    "lesson_name": lesson.name if lesson else None,
                    "lesson_info": lesson.info if lesson else None,
                }
            )

    return update
