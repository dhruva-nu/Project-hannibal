import uuid

from pydantic import BaseModel

from app.models.lesson_model import LessonType


class LessonCreate(BaseModel):
    courseId: int
    name: str
    learning: str
    nosqlId: uuid.UUID
    lessonType: LessonType
    order: int = 0


class LessonUpdate(BaseModel):
    name: str | None = None
    learning: str | None = None
    nosqlId: uuid.UUID | None = None
    lessonType: LessonType | None = None
    order: int | None = None


class LessonResponse(BaseModel):
    id: int
    courseId: int
    name: str
    learning: str
    nosqlId: uuid.UUID
    lessonType: LessonType
    order: int

    model_config = {"from_attributes": True, "populate_by_name": True}
