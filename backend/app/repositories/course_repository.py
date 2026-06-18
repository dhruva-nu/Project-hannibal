from sqlalchemy.orm import Session

from app.models.course_model import Course, CourseLevel
from app.models.course_related_course_model import CourseRelatedCourse
from app.models.lesson_model import Lesson


class CourseRepository:
    def __init__(self, db: Session) -> None:
        self._db = db

    def get_all(self) -> list[Course]:
        return self._db.query(Course).all()

    def get_by_id(self, course_id: int) -> Course | None:
        return self._db.query(Course).filter(Course.id == course_id).first()

    def get_by_ids(self, course_ids: list[int]) -> list[Course]:
        if not course_ids:
            return []
        return self._db.query(Course).filter(Course.id.in_(course_ids)).all()

    def create(
        self,
        name: str,
        category: list[str],
        level: CourseLevel,
        description: str,
        coverImg: str | None = None,
        tagId: int | None = None,
        enrolNum: int = 0,
        lessonCount: int = 0,
    ) -> Course:
        course = Course(
            name=name,
            category=category,
            tagId=tagId,
            enrolNum=enrolNum,
            coverImg=coverImg,
            level=level,
            description=description,
            lessonCount=lessonCount,
        )
        self._db.add(course)
        self._db.commit()
        self._db.refresh(course)
        return course

    def update(self, course: Course, **fields) -> Course:
        for key, value in fields.items():
            if value is not None:
                setattr(course, key, value)
        self._db.commit()
        self._db.refresh(course)
        return course

    def delete(self, course: Course) -> None:
        self._db.delete(course)
        self._db.commit()

    def get_lesson(self, lesson_id: int) -> Lesson | None:
        return self._db.query(Lesson).filter(Lesson.id == lesson_id).first()

    def get_related_courses(self, course_id: int) -> list[CourseRelatedCourse]:
        return (
            self._db.query(CourseRelatedCourse)
            .filter(CourseRelatedCourse.courseId == course_id)
            .order_by(CourseRelatedCourse.rank)
            .all()
        )

    def get_related_course_by_id(self, related_id: int) -> CourseRelatedCourse | None:
        return (
            self._db.query(CourseRelatedCourse)
            .filter(CourseRelatedCourse.id == related_id)
            .first()
        )

    def update_related_course(
        self, related: CourseRelatedCourse, **fields
    ) -> CourseRelatedCourse:
        for key, value in fields.items():
            if value is not None:
                setattr(related, key, value)
        self._db.commit()
        self._db.refresh(related)
        return related
