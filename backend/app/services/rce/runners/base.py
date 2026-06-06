from collections.abc import AsyncGenerator
from typing import Protocol

from ..events import ErrorEvent, ExitEvent, StderrLine, StdoutLine

Event = StdoutLine | StderrLine | ExitEvent | ErrorEvent


class Runner(Protocol):
    def stream(self, code: str, language: str) -> AsyncGenerator[Event]: ...
