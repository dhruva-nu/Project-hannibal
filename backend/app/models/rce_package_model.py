from datetime import datetime

from sqlalchemy import Boolean, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class RcePackage(Base):
    """A third-party package known to the code-execution deps index.

    One row per (language, name). ``exists`` records the registry verdict from
    the last lookup; ``in_cache`` marks packages actually installed in the
    sandbox cache volume (the runnable set — flipped by the warm pipeline).
    """

    __tablename__ = "rce_packages"

    language: Mapped[str] = mapped_column(String(20), primary_key=True)
    name: Mapped[str] = mapped_column(
        String(214), primary_key=True
    )  # npm max name length
    exists: Mapped[bool] = mapped_column(Boolean, nullable=False)
    in_cache: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    checked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
