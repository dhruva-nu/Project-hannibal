"""Wire models for talking to the RCE microservice over RabbitMQ.

Mirrors ``rce_service.contracts`` on the worker side. The two services are
separate uv projects, so the models are duplicated deliberately (kept tiny and
versioned via ``v``) rather than sharing a package.
"""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

# jscpd:ignore-start -- deliberately mirrors rce_service/contracts.py, see module docstring
CONTRACT_VERSION = 1

JobMode = Literal["sync", "stream"]


class EmuConfigV1(BaseModel):
    """The lesson's emulator setup — emu's ``config.json``, on the wire.

    Fields emu does not know are rejected here, so a lesson asking for something
    the emulator cannot give fails at the boundary rather than exiting 78 inside
    the sandbox. What ``seed`` and ``faults`` *mean* stays emu's business, which
    is why they are opaque: emu validates them and fails the run loudly.
    """

    model_config = ConfigDict(extra="forbid")

    services: list[str] = Field(min_length=1)
    seed: dict[str, Any] = Field(default_factory=dict)
    faults: list[dict[str, Any]] = Field(default_factory=list)
    log_limit: int | None = None


class JobV1(BaseModel):
    v: int = CONTRACT_VERSION
    job_id: str
    mode: JobMode
    language: str
    code: str
    # Absent for every request that wants no infrastructure — and such a request
    # runs exactly as it did before emu existed.
    emu: EmuConfigV1 | None = None


class ResultBody(BaseModel):
    exec_id: str
    exit_code: int
    stdout: str
    stderr: str
    timed_out: bool
    duration_ms: int
    dependency_error: dict[str, Any] | None = None
    # emu's op log, told apart from the student's own stdout: the graded artifact.
    emu_oplog: list[dict[str, Any]] | None = None


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
