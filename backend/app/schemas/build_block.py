import uuid

from pydantic import BaseModel


class BuildBlockCreate(BaseModel):
    id: uuid.UUID | None = None
    instructions: str
    input: str
    output: str
    test_code: str
    code_template: str
    type: str


class BuildBlockUpdate(BaseModel):
    instructions: str | None = None
    input: str | None = None
    output: str | None = None
    test_code: str | None = None
    code_template: str | None = None


class TestCaseResponse(BaseModel):
    model_config = {"from_attributes": True}
    name: str
    description: str


class BuildBlockResponse(BaseModel):
    id: uuid.UUID
    instructions: str
    input: str
    output: str
    test_code: str
    code_template: str
    type: str
    tests: list[TestCaseResponse] = []
    model_config = {"from_attributes": True}
