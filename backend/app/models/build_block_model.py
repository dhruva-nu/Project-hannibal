import uuid
from beanie import Document
from pydantic import BaseModel, Field


class TestCases(BaseModel):
    name: str
    description: str


class BuildBlock(Document):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    instructions: str
    input: str
    output: str
    test_code: str
    code_template: str
    type: str
    tests: list[TestCases] = Field(default_factory=list)

    class Settings:
        name = "build_blocks"
