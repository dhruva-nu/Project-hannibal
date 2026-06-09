from datetime import UTC, datetime

from beanie import Document
from pydantic import Field


class UserPreference(Document):
    preferences: dict[str, str] = Field(default_factory=dict)
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    class Settings:
        name = "user_preferences"
