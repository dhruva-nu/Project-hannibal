import uuid

from sqlalchemy.orm import Session

from app.models.lesson_model import Lesson, LessonType


class LessonRepository:
    def __init__(self, db: Session) -> None:
        self._db = db

    def get_all(self) -> list[Lesson]:
        return self._db.query(Lesson).all()

    def get_by_id(self, lesson_id: int) -> Lesson | None:
        return self._db.query(Lesson).filter(Lesson.id == lesson_id).first()

    def get_by_course(self, course_id: int) -> list[Lesson]:
        return self._db.query(Lesson).filter(Lesson.courseId == course_id).all()

    def create(
        self,
        courseId: int,
        name: str,
        learning: str,
        nosqlId: uuid.UUID,
        lessonType: LessonType,
    ) -> Lesson:
        lesson = Lesson(
            courseId=courseId,
            name=name,
            learning=learning,
            nosqlId=nosqlId,
            lessonType=lessonType,
        )
        self._db.add(lesson)
        self._db.commit()
        self._db.refresh(lesson)
        return lesson

    def update(self, lesson: Lesson, **fields) -> Lesson:
        for key, value in fields.items():
            if value is not None:
                setattr(lesson, key, value)
        self._db.commit()
        self._db.refresh(lesson)
        return lesson

    def delete(self, lesson: Lesson) -> None:
        self._db.delete(lesson)
        self._db.commit()
