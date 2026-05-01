from pydantic import BaseModel


class ExecuteRequest(BaseModel):
    code: str
    language: str


class ExecuteResponse(BaseModel):
    exec_id: str
    language: str
    exit_code: int
    stdout: str
    stderr: str
    timed_out: bool
    duration_ms: int
