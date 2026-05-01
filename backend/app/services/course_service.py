from app.models.course_model import CourseLevel
from app.repositories.course_repository import CourseRepository
from app.schemas.course import CourseResponse


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

    def create_course(
        self,
        name: str,
        category: list[str],
        coverImg: str,
        level: CourseLevel,
        description: str,
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

    def delete_course(self, course_id: int) -> None:
        course = self._repository.get_by_id(course_id)
        if not course:
            raise ValueError(f"Course {course_id} not found")
        self._repository.delete(course)
