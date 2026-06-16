from pgvector.sqlalchemy import Vector
from sqlalchemy import ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.course_embedding_model import EMBEDDING_DIM


class LessonEmbedding(Base):
    __tablename__ = "lesson_embeddings"

    lessonId: Mapped[int] = mapped_column(
        "lesson_id",
        Integer,
        ForeignKey("lessons.id", ondelete="CASCADE"),
        primary_key=True,
    )
    courseId: Mapped[int] = mapped_column(
        "course_id",
        Integer,
        ForeignKey("courses.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    embedding: Mapped[list[float]] = mapped_column(
        Vector(EMBEDDING_DIM), nullable=False
    )
