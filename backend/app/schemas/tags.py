from pydantic import BaseModel


class TagCreate(BaseModel):
    name: str
    description: str


class TagUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


class TagResponse(BaseModel):
    id: int
    name: str
    description: str

    model_config = {"from_attributes": True}
