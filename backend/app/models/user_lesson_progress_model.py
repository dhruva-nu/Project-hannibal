from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class UserLessonProgress(Base):
    __tablename__ = "user_lesson_progress"

    userId: Mapped[int] = mapped_column(
        "user_id",
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
        index=True,
    )
    lessonId: Mapped[int] = mapped_column(
        "lesson_id",
        Integer,
        ForeignKey("lessons.id", ondelete="CASCADE"),
        primary_key=True,
    )
    completedAt: Mapped[datetime] = mapped_column(
        "completed_at",
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
