from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.rce import DependencyError


class RunSimpleRequest(BaseModel):
    code: str = Field(..., max_length=65_536)
    language: str
    block_id: UUID


class RunSimpleResponse(BaseModel):
    exec_id: str
    language: str
    block_id: UUID
    exit_code: int
    stdout: str
    stderr: str
    timed_out: bool
    duration_ms: int
    dependency_error: DependencyError | None = None
