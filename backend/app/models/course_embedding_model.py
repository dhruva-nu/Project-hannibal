from pgvector.sqlalchemy import Vector
from sqlalchemy import ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

# Google text-embedding-004 (via langchain-google-genai) emits 768-dim vectors.
EMBEDDING_DIM = 768


class CourseEmbedding(Base):
    __tablename__ = "course_embeddings"

    courseId: Mapped[int] = mapped_column(
        "course_id",
        Integer,
        ForeignKey("courses.id", ondelete="CASCADE"),
        primary_key=True,
    )
    embedding: Mapped[list[float]] = mapped_column(
        Vector(EMBEDDING_DIM), nullable=False
    )
