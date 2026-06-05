from sqlalchemy.orm import Session

from app.models.lesson_model import Lesson
from app.models.user_course_progress_model import UserCourseProgress
from app.models.user_lesson_progress_model import UserLessonProgress


class ProgressRepository:
    def __init__(self, db: Session) -> None:
        self._db = db

    def get_course_progress(
        self, user_id: int, course_id: int
    ) -> UserCourseProgress | None:
        return (
            self._db.query(UserCourseProgress)
            .filter(
                UserCourseProgress.userId == user_id,
                UserCourseProgress.courseId == course_id,
            )
            .first()
        )

    def create_course_progress(
        self, user_id: int, course_id: int
    ) -> UserCourseProgress:
        row = UserCourseProgress(
            userId=user_id,
            courseId=course_id,
            activeLessonId=None,
            placedNodeIds=[],
        )
        self._db.add(row)
        self._db.commit()
        self._db.refresh(row)
        return row

    def update_course_progress(
        self,
        row: UserCourseProgress,
        active_lesson_id: int | None = None,
        placed_node_ids: list[str] | None = None,
    ) -> UserCourseProgress:
        if active_lesson_id is not None:
            row.activeLessonId = active_lesson_id
        if placed_node_ids is not None:
            existing = set(row.placedNodeIds or [])
            existing.update(placed_node_ids)
            row.placedNodeIds = list(existing)
        self._db.commit()
        self._db.refresh(row)
        return row

    def delete_course_progress(self, row: UserCourseProgress) -> None:
        self._db.delete(row)
        self._db.commit()

    def list_completed_lesson_ids(self, user_id: int, course_id: int) -> list[int]:
        rows = (
            self._db.query(UserLessonProgress.lessonId)
            .join(Lesson, Lesson.id == UserLessonProgress.lessonId)
            .filter(
                UserLessonProgress.userId == user_id,
                Lesson.courseId == course_id,
            )
            .all()
        )
        return [r[0] for r in rows]

    def get_lesson_progress(
        self, user_id: int, lesson_id: int
    ) -> UserLessonProgress | None:
        return (
            self._db.query(UserLessonProgress)
            .filter(
                UserLessonProgress.userId == user_id,
                UserLessonProgress.lessonId == lesson_id,
            )
            .first()
        )

    def create_lesson_progress(
        self, user_id: int, lesson_id: int
    ) -> UserLessonProgress:
        row = UserLessonProgress(userId=user_id, lessonId=lesson_id)
        self._db.add(row)
        self._db.commit()
        self._db.refresh(row)
        return row

    def delete_lesson_progress_for_course(self, user_id: int, course_id: int) -> None:
        rows = (
            self._db.query(UserLessonProgress)
            .join(Lesson, Lesson.id == UserLessonProgress.lessonId)
            .filter(
                UserLessonProgress.userId == user_id,
                Lesson.courseId == course_id,
            )
            .all()
        )
        for row in rows:
            self._db.delete(row)
        self._db.commit()

    def get_lesson(self, lesson_id: int) -> Lesson | None:
        return self._db.query(Lesson).filter(Lesson.id == lesson_id).first()
