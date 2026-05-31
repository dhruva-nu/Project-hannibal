import uuid

from app.models.lesson_model import LessonType
from app.repositories.lesson_repository import LessonRepository
from app.schemas.lesson import LessonResponse


class LessonService:
    def __init__(self, repository: LessonRepository) -> None:
        self._repository = repository

    def list_lessons(self) -> list[LessonResponse]:
        return [
            LessonResponse.model_validate(row) for row in self._repository.get_all()
        ]

    def list_by_course(self, course_id: int) -> list[LessonResponse]:
        return [
            LessonResponse.model_validate(row)
            for row in self._repository.get_by_course(course_id)
        ]

    def get_lesson(self, lesson_id: int) -> LessonResponse:
        lesson = self._repository.get_by_id(lesson_id)
        if not lesson:
            raise ValueError(f"Lesson {lesson_id} not found")
        return LessonResponse.model_validate(lesson)

    def create_lesson(
        self,
        courseId: int,
        name: str,
        learning: str,
        nosqlId: uuid.UUID,
        lessonType: LessonType,
    ) -> LessonResponse:
        lesson = self._repository.create(
            courseId=courseId,
            name=name,
            learning=learning,
            nosqlId=nosqlId,
            lessonType=lessonType,
        )
        return LessonResponse.model_validate(lesson)

    def update_lesson(self, lesson_id: int, **fields) -> LessonResponse:
        lesson = self._repository.get_by_id(lesson_id)
        if not lesson:
            raise ValueError(f"Lesson {lesson_id} not found")
        lesson = self._repository.update(lesson, **fields)
        return LessonResponse.model_validate(lesson)

    def delete_lesson(self, lesson_id: int) -> None:
        lesson = self._repository.get_by_id(lesson_id)
        if not lesson:
            raise ValueError(f"Lesson {lesson_id} not found")
        self._repository.delete(lesson)
