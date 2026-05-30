from uuid import UUID

from app.services.build_block_service import BuildBlockService

from .config import RUNTIME, SUPPORTED_LANGS
from .docker import run_code, stream_code
from .events import ErrorEvent, ExitEvent, StderrLine, StdoutLine
from .runners.simple import SimpleRunner, add_test_code


async def run_simple(
    code: str,
    language: str,
    block_id: UUID,
    build_block_service: BuildBlockService,
) -> dict:
    final_code = await add_test_code(code, block_id, build_block_service)
    runner = SimpleRunner()
    stdout = stderr = ""
    exit_code = timed_out = duration_ms = exec_id = None

    async for event in runner.stream(final_code, language):
        if isinstance(event, StdoutLine):
            stdout = event.line
            exec_id = event.exec_id
        elif isinstance(event, StderrLine):
            stderr = event.line
        elif isinstance(event, ExitEvent):
            exit_code = event.exit_code
            timed_out = event.timed_out
            duration_ms = event.duration_ms

    return {
        "exec_id": exec_id,
        "stdout": stdout,
        "stderr": stderr,
        "exit_code": exit_code,
        "timed_out": timed_out,
        "duration_ms": duration_ms,
    }
