from sqlalchemy.orm import Session

from app.models.course_model import Course, CourseLevel


class CourseRepository:
    def __init__(self, db: Session) -> None:
        self._db = db

    def get_all(self) -> list[Course]:
        return self._db.query(Course).all()

    def get_by_id(self, course_id: int) -> Course | None:
        return self._db.query(Course).filter(Course.id == course_id).first()

    def create(
        self,
        name: str,
        category: list[str],
        coverImg: str,
        level: CourseLevel,
        description: str,
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
