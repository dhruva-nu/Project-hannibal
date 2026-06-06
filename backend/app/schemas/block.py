import uuid
from typing import Annotated, Literal

from pydantic import BaseModel


class LessonBlockItem(BaseModel):
    type: Literal["lesson"] = "lesson"
    id: uuid.UUID
    content: str
    summary: str

    model_config = {"from_attributes": True}


class BuildBlockItem(BaseModel):
    type: Literal["build"] = "build"
    id: uuid.UUID
    instructions: str
    input: str
    output: str
    test_code: str
    code_template: str

    model_config = {"from_attributes": True}


BlockItem = Annotated[LessonBlockItem | BuildBlockItem, ...]
