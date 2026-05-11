from app.repositories.lesson_block_repository import LessonBlockRepository
from app.services.lesson_block_service import LessonBlockService


def get_lesson_block_service() -> LessonBlockService:
    return LessonBlockService(repository=LessonBlockRepository())
