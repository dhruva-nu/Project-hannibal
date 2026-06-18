from app.models.course_model import CourseLevel
from app.repositories.course_repository import CourseRepository
from app.schemas.course import CourseResponse, RelatedCourseResponse


class CourseService:
    def __init__(self, repository: CourseRepository) -> None:
        self._repository = repository

    def list_courses(self) -> list[CourseResponse]:
        return [CourseResponse.model_validate(c) for c in self._repository.get_all()]

    def get_course(self, course_id: int) -> CourseResponse:
        course = self._repository.get_by_id(course_id)
        if not course:
            raise ValueError(f"Course {course_id} not found")
        return CourseResponse.model_validate(course)

    def get_courses(self, course_ids: list[int]) -> list[CourseResponse]:
        courses = {c.id: c for c in self._repository.get_by_ids(course_ids)}
        return [
            CourseResponse.model_validate(courses[cid])
            for cid in course_ids
            if cid in courses
        ]

    def create_course(
        self,
        name: str,
        category: list[str],
        level: CourseLevel,
        description: str,
        coverImg: str | None = None,
        tagId: int | None = None,
        enrolNum: int = 0,
        lessonCount: int = 0,
    ) -> CourseResponse:
        course = self._repository.create(
            name=name,
            category=category,
            coverImg=coverImg,
            level=level,
            description=description,
            tagId=tagId,
            enrolNum=enrolNum,
            lessonCount=lessonCount,
        )
        return CourseResponse.model_validate(course)

    def update_course(self, course_id: int, **fields) -> CourseResponse:
        course = self._repository.get_by_id(course_id)
        if not course:
            raise ValueError(f"Course {course_id} not found")
        course = self._repository.update(course, **fields)
        return CourseResponse.model_validate(course)

    def get_related_courses(self, course_id: int) -> list[RelatedCourseResponse]:
        course = self._repository.get_by_id(course_id)
        if not course:
            raise ValueError(f"Course {course_id} not found")
        return [
            RelatedCourseResponse.model_validate(r)
            for r in self._repository.get_related_courses(course_id)
        ]

    def update_related_course(self, related_id: int, **fields) -> RelatedCourseResponse:
        related = self._repository.get_related_course_by_id(related_id)
        if not related:
            raise ValueError(f"Related course {related_id} not found")
        related = self._repository.update_related_course(related, **fields)
        return RelatedCourseResponse.model_validate(related)

    def delete_course(self, course_id: int) -> None:
        course = self._repository.get_by_id(course_id)
        if not course:
            raise ValueError(f"Course {course_id} not found")
        self._repository.delete(course)
