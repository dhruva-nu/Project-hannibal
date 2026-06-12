from enum import Enum as PyEnum

from sqlalchemy import Enum as SAEnum
from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class CourseLevel(str, PyEnum):
    beginner = "beginner"
    intermediate = "intermediate"
    expert = "expert"


class Course(Base):
    __tablename__ = "courses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(50), nullable=False)
    category: Mapped[list[str]] = mapped_column(ARRAY(String(20)), nullable=False)
    tagId: Mapped[int | None] = mapped_column(
        "tag_id", Integer, ForeignKey("tags.id"), nullable=True
    )
    enrolNum: Mapped[int] = mapped_column(
        "enrol_num", Integer, nullable=False, default=0
    )
    coverImg: Mapped[str] = mapped_column("cover_img", String, nullable=False)
    level: Mapped[CourseLevel] = mapped_column(
        SAEnum(CourseLevel, name="course_level"), nullable=False
    )
    description: Mapped[str] = mapped_column(Text, nullable=False)
    info: Mapped[str | None] = mapped_column(Text, nullable=True)
    lessonCount: Mapped[int] = mapped_column(
        "lesson_count", Integer, nullable=False, default=0
    )
