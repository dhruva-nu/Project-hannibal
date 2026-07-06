"""Turning a decoded job into a result (sync) or a stream of events.

This is the seam the old ``rce_controller`` / ``run_simple`` occupied: resolve
dependencies, run the sandbox, and package the outcome. Dependency failures are
**not** errors here — they come back as a normal result with ``dependency_error``
set (sync) or a ``dependency_error`` event (stream), exactly as the frontend
already expects. Only saturation and unexpected faults become transport errors.
"""

import asyncio
import logging
import uuid
from collections.abc import AsyncGenerator

from .contracts import EventV1, JobV1, ResultBody, ResultError, ResultV1
from .dependency_errors import dependency_error_info, dependency_error_result
from .docker import run_code, stream_code
from .events import DependencyErrorEvent, ErrorEvent, ExitEvent, StdoutLine
from .exceptions import DependencyInstallError, UnpermittedDependency
from .two_phase import prepare_dependencies

logger = logging.getLogger(__name__)


def _event(job: JobV1, event) -> EventV1:
    return EventV1(job_id=job.job_id, event=event.to_dict())


async def handle_sync(job: JobV1) -> ResultV1:
    """Run to completion and return one result message."""
    try:
        await prepare_dependencies(job.code, job.language)
        result = await asyncio.get_running_loop().run_in_executor(
            None, run_code, job.code, job.language
        )
    except (UnpermittedDependency, DependencyInstallError) as exc:
        logger.info("dependency error | job_id=%s error=%s", job.job_id, exc)
        return ResultV1(
            job_id=job.job_id,
            ok=True,
            result=ResultBody(**dependency_error_result(exc)),
        )
    except ValueError as exc:  # run semaphore exhausted
        return ResultV1(
            job_id=job.job_id,
            ok=False,
            error=ResultError(code="saturated", message=str(exc)),
        )
    except Exception:
        logger.exception("execute failed | job_id=%s", job.job_id)
        return ResultV1(
            job_id=job.job_id,
            ok=False,
            error=ResultError(code="internal", message="Execution service error."),
        )

    return ResultV1(job_id=job.job_id, ok=True, result=ResultBody(**result))


async def handle_stream(job: JobV1) -> AsyncGenerator[EventV1]:
    """Yield stdout events line-by-line, terminated by exit/error/dependency_error.

    Mirrors the old SSE path: Docker merges stdout+stderr into the log stream,
    so every line is a ``stdout`` event. The terminal ``exit`` event tells the
    backend relay the run is over (the frontend ignores it, as it did before).
    """
    exec_id = str(uuid.uuid4())
    try:
        await prepare_dependencies(job.code, job.language)
        async for line in stream_code(job.code, job.language):
            yield _event(
                job, StdoutLine(exec_id=exec_id, line=line.decode(errors="replace"))
            )
        yield _event(
            job, ExitEvent(exec_id=exec_id, exit_code=0, timed_out=False, duration_ms=0)
        )
    except (UnpermittedDependency, DependencyInstallError) as exc:
        logger.info("dependency error | job_id=%s error=%s", job.job_id, exc)
        yield _event(
            job, DependencyErrorEvent(exec_id=exec_id, **dependency_error_info(exc))
        )
    except ValueError as exc:  # run semaphore exhausted
        yield _event(job, ErrorEvent(exec_id=exec_id, message=str(exc)))
    except Exception:
        logger.exception("stream failed | job_id=%s", job.job_id)
        yield _event(
            job, ErrorEvent(exec_id=exec_id, message="Execution service error.")
        )
