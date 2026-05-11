import uuid
from beanie import Document
from pydantic import Field


class LessonBlock(Document):
    id: uuid.UUID = Field(default_factory=uuid.uuid4)
    content: str
    summary: str

    class Settings:
        name = "lesson_blocks"
