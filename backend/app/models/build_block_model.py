import uuid
from beanie import Document
from pydantic import Field


class BuildBlock(Document):
    id: uuid.UUID = Field(default_factory=uuid.uuid4)
    instructions: str
    input: str
    output: str
    test_code: str
    code_template: str
    type: str

    class Settings:
        name = "build_blocks"
