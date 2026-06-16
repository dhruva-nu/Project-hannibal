from enum import Enum as PyEnum

from sqlalchemy import Enum as SAEnum
from sqlalchemy import ForeignKey, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class RelatedCourseSource(str, PyEnum):
    top5 = "top5"
    overflow = "overflow"


class CourseRelatedCourse(Base):
    __tablename__ = "course_related_courses"
    __table_args__ = (
        UniqueConstraint(
            "course_id", "related_course_id", name="uq_course_related_pair"
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    courseId: Mapped[int] = mapped_column(
        "course_id",
        Integer,
        ForeignKey("courses.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    relatedCourseId: Mapped[int] = mapped_column(
        "related_course_id",
        Integer,
        ForeignKey("courses.id", ondelete="CASCADE"),
        nullable=False,
    )
    source: Mapped[RelatedCourseSource] = mapped_column(
        SAEnum(RelatedCourseSource, name="related_course_source"), nullable=False
    )
    rank: Mapped[int | None] = mapped_column(Integer, nullable=True)
    noOfCalls: Mapped[int] = mapped_column(
        "no_of_calls", Integer, nullable=False, default=0
    )
