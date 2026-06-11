from pydantic import BaseModel


class PreferenceKeyResponse(BaseModel):
    id: int
    key: str
    description: str

    model_config = {"from_attributes": True}


class PreferenceUpsert(BaseModel):
    key: str
    value: str


class UserPreferenceResponse(BaseModel):
    preferences: dict[str, str]
