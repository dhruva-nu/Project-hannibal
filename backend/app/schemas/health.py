from pydantic import BaseModel


class HealthPayload(BaseModel):
    status: str
    service: str

    model_config = {"from_attributes": True}


class HealthResponse(HealthPayload):
    pass
