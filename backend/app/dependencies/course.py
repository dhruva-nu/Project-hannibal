from typing import Annotated

from fastapi import Depends

from app.dependencies.db import DbSession
from app.repositories.course_repository import CourseRepository
from app.repositories.lesson_block_repository import LessonBlockRepository
from app.repositories.lesson_repository import LessonRepository
from app.services.course_service import CourseService
from app.services.lesson_block_service import LessonBlockService
from app.services.lesson_service import LessonService


def get_course_service(db: DbSession) -> CourseService:
    return CourseService(repository=CourseRepository(db=db))


def get_lesson_service(db: DbSession) -> LessonService:
    return LessonService(repository=LessonRepository(db=db))


def get_lesson_block_service() -> LessonBlockService:
    return LessonBlockService(repository=LessonBlockRepository())


CourseServiceDep = Annotated[CourseService, Depends(get_course_service)]
LessonServiceDep = Annotated[LessonService, Depends(get_lesson_service)]
LessonBlockServiceDep = Annotated[LessonBlockService, Depends(get_lesson_block_service)]
