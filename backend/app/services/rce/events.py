import dataclasses
from dataclasses import dataclass


@dataclass
class StdoutLine:
    exec_id: str
    line: str
    event_type: str = "stdout"

    def to_dict(self) -> dict:
        return dataclasses.asdict(self)


@dataclass
class StderrLine:
    exec_id: str
    line: str
    event_type: str = "stderr"

    def to_dict(self) -> dict:
        return dataclasses.asdict(self)


@dataclass
class ExitEvent:
    exec_id: str
    exit_code: int
    timed_out: bool
    duration_ms: int
    event_type: str = "exit"

    def to_dict(self) -> dict:
        return dataclasses.asdict(self)


@dataclass
class ErrorEvent:
    exec_id: str
    message: str
    event_type: str = "error"

    def to_dict(self) -> dict:
        return dataclasses.asdict(self)
