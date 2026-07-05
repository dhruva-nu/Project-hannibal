from typing import Literal

from pydantic import BaseModel, Field


class ExecuteRequest(BaseModel):
    code: str = Field(..., max_length=65_536)
    language: str


class DependencyError(BaseModel):
    """A dependency failure the student can act on — never a raw traceback."""

    package: str
    reason: str
    kind: Literal["not_allowed", "install_failed"]


class ExecuteResponse(BaseModel):
    exec_id: str
    language: str
    exit_code: int
    stdout: str
    stderr: str
    timed_out: bool
    duration_ms: int
    dependency_error: DependencyError | None = None
