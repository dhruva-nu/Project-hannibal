"""The RabbitMQ message contracts between the backend gateway and this worker.

All bodies carry ``v`` for forward-compatible evolution. A job is either a
``sync`` execution (reply with one :class:`ResultV1`) or a ``stream`` execution
(publish :class:`EventV1` frames to the events exchange, keyed by ``job_id``).
The ``result.dependency_error`` shape and the event payloads are byte-compatible
with what the frontend already parses, so the migration is invisible to it.
"""

from typing import Any, Literal

from pydantic import BaseModel, Field

# jscpd:ignore-start -- deliberately mirrors rce_gateway/contracts.py, see module docstring
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
    # Exactly the dataclass ``to_dict()`` payload from events.py (stdout /
    # stderr / exit / error / dependency_error), forwarded verbatim as SSE.
    event: dict[str, Any] = Field(default_factory=dict)


# jscpd:ignore-end
