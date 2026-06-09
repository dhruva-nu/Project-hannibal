from datetime import UTC, datetime
from enum import Enum as PyEnum

from sqlalchemy import DateTime, Integer, String
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Role(str, PyEnum):
    admin = "admin"
    student = "student"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String, nullable=False, unique=True, index=True)
    role: Mapped[str] = mapped_column(
        SAEnum(Role, name="users_level"), nullable=False, default=Role("admin")
    )
    hashed_password: Mapped[str | None] = mapped_column(String, nullable=True)
    provider: Mapped[str] = mapped_column(
        String, nullable=False, server_default="local"
    )
    oauth_id: Mapped[str | None] = mapped_column(String, nullable=True)
    preference_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
    )
