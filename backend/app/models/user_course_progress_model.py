from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class UserCourseProgress(Base):
    __tablename__ = "user_course_progress"

    userId: Mapped[int] = mapped_column(
        "user_id",
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    courseId: Mapped[int] = mapped_column(
        "course_id",
        Integer,
        ForeignKey("courses.id", ondelete="CASCADE"),
        primary_key=True,
    )
    activeLessonId: Mapped[int | None] = mapped_column(
        "active_lesson_id",
        Integer,
        ForeignKey("lessons.id", ondelete="SET NULL"),
        nullable=True,
    )
    placedNodeIds: Mapped[list[str]] = mapped_column(
        "placed_node_ids",
        ARRAY(String(64)),
        nullable=False,
        default=list,
        server_default="{}",
    )
    enrolledAt: Mapped[datetime] = mapped_column(
        "enrolled_at",
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
    )
    updatedAt: Mapped[datetime] = mapped_column(
        "updated_at",
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )
