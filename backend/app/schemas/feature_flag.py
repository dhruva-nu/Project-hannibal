from datetime import datetime

from pydantic import BaseModel, Field


class FeatureFlagCreate(BaseModel):
    key: str = Field(min_length=1, max_length=64)
    description: str = ""
    enabled: bool = False
    rollout_percentage: int = Field(default=0, ge=0, le=100)
    target_roles: list[str] | None = None


class FeatureFlagUpdate(BaseModel):
    description: str | None = None
    enabled: bool | None = None
    rollout_percentage: int | None = Field(default=None, ge=0, le=100)
    target_roles: list[str] | None = None


class FeatureFlagResponse(BaseModel):
    id: int
    key: str
    description: str
    enabled: bool
    rollout_percentage: int
    target_roles: list[str] | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class FeatureFlagEvaluation(BaseModel):
    flags: dict[str, bool]
