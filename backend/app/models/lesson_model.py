from enum import Enum as PyEnum
import uuid

from sqlalchemy import Enum as SAEnum, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class LessonType(str, PyEnum):
    build = "build"
    learn = "learn"


class Lesson(Base):
    __tablename__ = "lessons"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    courseId: Mapped[int] = mapped_column(
        "course_id", Integer, ForeignKey("courses.id"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(50), nullable=False)
    learning: Mapped[str] = mapped_column(Text, nullable=False)
    nosqlId: Mapped[uuid.UUID] = mapped_column(
        "nosql_id", UUID(as_uuid=True), nullable=False
    )
    lessonType: Mapped[LessonType] = mapped_column(
        "type", SAEnum(LessonType, name="lesson_type"), nullable=False
    )
    order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
