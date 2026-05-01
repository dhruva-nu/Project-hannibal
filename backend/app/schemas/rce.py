from pydantic import BaseModel, Field


class ExecuteRequest(BaseModel):
    code: str = Field(..., max_length=65_536)
    language: str


class ExecuteResponse(BaseModel):
    exec_id: str
    language: str
    exit_code: int
    stdout: str
    stderr: str
    timed_out: bool
    duration_ms: int
