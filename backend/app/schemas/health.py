from pydantic import BaseModel


class HealthPayload(BaseModel):
    status: str
    service: str


class HealthResponse(HealthPayload):
    pass
