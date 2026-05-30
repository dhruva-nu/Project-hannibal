from typing import AsyncGenerator, Protocol, Union

from ..events import ErrorEvent, ExitEvent, StderrLine, StdoutLine

Event = Union[StdoutLine, StderrLine, ExitEvent, ErrorEvent]


class Runner(Protocol):
    def stream(self, code: str, language: str) -> AsyncGenerator[Event, None]: ...
