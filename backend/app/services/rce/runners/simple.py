import asyncio
import logging
from collections.abc import AsyncGenerator
from uuid import UUID

from app.exception.dsl import TestCodeSyntaxFailure
from app.services.build_block_service import BuildBlockService

from ..docker import run_code
from ..events import ExitEvent, StderrLine, StdoutLine

logger = logging.getLogger(__name__)

Event = StdoutLine | StderrLine | ExitEvent


async def add_test_code(
    user_code: str,
    build_block_id: UUID,
    build_block_service: BuildBlockService,
) -> str:
    block = await build_block_service.get_block(build_block_id)
    test_code = block.test_code
    before, sep, after = test_code.partition("--user-code--")
    if not sep:
        raise TestCodeSyntaxFailure(build_block_id, test_code)
    return before + user_code + after


class SimpleRunner:
    async def stream(self, code: str, language: str) -> AsyncGenerator[Event]:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, run_code, code, language)
        exec_id = result["exec_id"]
        yield StdoutLine(exec_id=exec_id, line=result["stdout"])
        yield StderrLine(exec_id=exec_id, line=result["stderr"])
        yield ExitEvent(
            exec_id=exec_id,
            exit_code=result["exit_code"],
            timed_out=result["timed_out"],
            duration_ms=result["duration_ms"],
        )
