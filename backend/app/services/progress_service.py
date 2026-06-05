from app.models.user_course_progress_model import UserCourseProgress
from app.repositories.course_repository import CourseRepository
from app.repositories.progress_repository import ProgressRepository
from app.schemas.progress import CourseProgressResponse


class ProgressService:
    def __init__(
        self,
        repository: ProgressRepository,
        course_repository: CourseRepository,
    ) -> None:
        self._repository = repository
        self._course_repository = course_repository

    def get_progress(self, user_id: int, course_id: int) -> CourseProgressResponse:
        row = self._repository.get_course_progress(user_id, course_id)
        if row is None:
            raise ValueError(f"User {user_id} not enrolled in course {course_id}")
        return self._to_response(row)

    def enroll(self, user_id: int, course_id: int) -> CourseProgressResponse:
        row = self._repository.get_course_progress(user_id, course_id)
        if row is None:
            course = self._course_repository.get_by_id(course_id)
            if course is None:
                raise ValueError(f"Course {course_id} not found")
            row = self._repository.create_course_progress(user_id, course_id)
            self._course_repository.update(course, enrolNum=course.enrolNum + 1)
        return self._to_response(row)

    def update_progress(
        self,
        user_id: int,
        course_id: int,
        active_lesson_id: int | None = None,
        placed_node_ids: list[str] | None = None,
    ) -> CourseProgressResponse:
        row = self._ensure_enrolled(user_id, course_id)
        if active_lesson_id is not None:
            lesson = self._repository.get_lesson(active_lesson_id)
            if lesson is None or lesson.courseId != course_id:
                raise ValueError(
                    f"Lesson {active_lesson_id} does not belong to course {course_id}"
                )
        row = self._repository.update_course_progress(
            row,
            active_lesson_id=active_lesson_id,
            placed_node_ids=placed_node_ids,
        )
        return self._to_response(row)

    def complete_lesson(
        self, user_id: int, course_id: int, lesson_id: int
    ) -> CourseProgressResponse:
        lesson = self._repository.get_lesson(lesson_id)
        if lesson is None or lesson.courseId != course_id:
            raise ValueError(
                f"Lesson {lesson_id} does not belong to course {course_id}"
            )
        self._ensure_enrolled(user_id, course_id)
        if self._repository.get_lesson_progress(user_id, lesson_id) is None:
            self._repository.create_lesson_progress(user_id, lesson_id)
        return self.get_progress(user_id, course_id)

    def reset_progress(self, user_id: int, course_id: int) -> None:
        row = self._repository.get_course_progress(user_id, course_id)
        if row is None:
            return
        self._repository.delete_lesson_progress_for_course(user_id, course_id)
        self._repository.delete_course_progress(row)

    def _ensure_enrolled(self, user_id: int, course_id: int) -> UserCourseProgress:
        row = self._repository.get_course_progress(user_id, course_id)
        if row is not None:
            return row
        course = self._course_repository.get_by_id(course_id)
        if course is None:
            raise ValueError(f"Course {course_id} not found")
        row = self._repository.create_course_progress(user_id, course_id)
        self._course_repository.update(course, enrolNum=course.enrolNum + 1)
        return row

    def _to_response(self, row: UserCourseProgress) -> CourseProgressResponse:
        completed = self._repository.list_completed_lesson_ids(row.userId, row.courseId)
        return CourseProgressResponse(
            courseId=row.courseId,
            completedLessonIds=completed,
            activeLessonId=row.activeLessonId,
            placedNodeIds=list(row.placedNodeIds or []),
            enrolledAt=row.enrolledAt,
        )
