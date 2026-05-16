import uuid

from pydantic import BaseModel


class LessonBlockCreate(BaseModel):
    id: uuid.UUID | None = None
    content: str
    summary: str


class LessonBlockUpdate(BaseModel):
    content: str | None = None
    summary: str | None = None


class LessonBlockResponse(BaseModel):
    id: uuid.UUID
    content: str
    summary: str

    model_config = {"from_attributes": True}
