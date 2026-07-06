"""Wire models for talking to the RCE microservice over RabbitMQ.

Mirrors ``rce_service.contracts`` on the worker side. The two services are
separate uv projects, so the models are duplicated deliberately (kept tiny and
versioned via ``v``) rather than sharing a package.
"""

from typing import Any, Literal

from pydantic import BaseModel, Field

# jscpd:ignore-start -- deliberately mirrors rce_service/contracts.py, see module docstring
CONTRACT_VERSION = 1

JobMode = Literal["sync", "stream"]


class JobV1(BaseModel):
    v: int = CONTRACT_VERSION
    job_id: str
    mode: JobMode
    language: str
    code: str


class ResultBody(BaseModel):
    exec_id: str
    exit_code: int
    stdout: str
    stderr: str
    timed_out: bool
    duration_ms: int
    dependency_error: dict[str, Any] | None = None


class ResultError(BaseModel):
    code: Literal["saturated", "internal"]
    message: str


class ResultV1(BaseModel):
    v: int = CONTRACT_VERSION
    job_id: str
    ok: bool
    result: ResultBody | None = None
    error: ResultError | None = None


class EventV1(BaseModel):
    v: int = CONTRACT_VERSION
    job_id: str
    event: dict[str, Any] = Field(default_factory=dict)


# jscpd:ignore-end
