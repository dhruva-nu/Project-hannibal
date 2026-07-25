import asyncio
import base64
import logging
import threading
import time
import uuid
from collections.abc import AsyncGenerator
from typing import TYPE_CHECKING

import docker
import requests.exceptions

from .config import LIMITS, RUNTIME
from .deps.cache import run_phase_mounts
from .result import _build_result, _truncate

if TYPE_CHECKING:  # infra imports this module, so the real import would cycle
    from .infra import EmulatorSession

logger = logging.getLogger(__name__)

_client: docker.DockerClient | None = None
_client_lock = threading.Lock()
# _semaphore cap (5) × pids_limit (10) = 50 host PIDs max from this service
_semaphore = threading.Semaphore(5)


def _cleanup_container(container, exec_id: str) -> None:
    try:
        container.stop(timeout=0)
    except Exception:
        logger.debug("container.stop failed | exec_id=%s", exec_id, exc_info=True)
    try:
        container.remove()
    except Exception:
        logger.debug("container.remove failed | exec_id=%s", exec_id, exc_info=True)


def _pull_missing_images(c: docker.DockerClient) -> None:
    for cfg in RUNTIME.values():
        try:
            c.images.get(cfg["image"])
        except docker.errors.ImageNotFound:
            logger.info("pulling image %s", cfg["image"])
            c.images.pull(cfg["image"])


def _get_client() -> docker.DockerClient:
    global _client
    with _client_lock:
        if _client is None:
            _client = docker.from_env()
            _pull_missing_images(_client)
    return _client


def _build_exec_context(code: str, language: str) -> tuple[dict, str, str, str]:
    """Return (runtime, exec_id, filename, encoded) for a code execution request."""
    runtime = RUNTIME[language]
    exec_id = str(uuid.uuid4())
    filename = f"/tmp/{exec_id}.{runtime['ext']}"  # nosec B108 — tmpfs sandbox mount
    encoded = base64.b64encode(code.encode()).decode()
    return runtime, exec_id, filename, encoded


def _network_posture(session: EmulatorSession | None) -> dict:
    """How the run container is wired to the world.

    Default and unchanged: no network stack at all. An infra lesson swaps that
    for the run's own ``internal`` sandbox network — still no internet, still no
    host, but the emulator's data ports are reachable by hostname.
    """
    if session is None:
        return {"network_mode": "none"}
    return {"network": session.sandbox_network.name}


def _start_container(
    runtime: dict, command: list[str], session: EmulatorSession | None = None
):
    """Run a sandboxed Docker container with standard security constraints.

    The only dependency-related additions are a **read-only** view of the
    language's package cache plus its resolution env var (``PYTHONPATH`` /
    ``NODE_PATH``); every other lockdown is unchanged from the pre-deps
    sandbox. An infra ``session`` adds the sandbox network and the emulator
    connection strings, and changes nothing else.
    """
    provider = runtime["deps"]
    return _get_client().containers.run(
        image=runtime["image"],
        command=command,
        detach=True,
        **_network_posture(session),
        mem_limit=LIMITS["memory"],
        memswap_limit=LIMITS["memory"],
        pids_limit=LIMITS["pid"],
        cap_drop=["ALL"],
        security_opt=["no-new-privileges"],
        user="65534:65534",
        read_only=True,
        tmpfs={"/tmp": "size=64m,mode=1777"},  # nosec B108 — sandboxed tmpfs
        volumes=run_phase_mounts(provider),
        # Lesson-authored connection strings first, the provider's own env last:
        # nothing a lesson declares may shadow how the sandbox resolves imports.
        environment={
            **(session.student_env if session is not None else {}),
            **provider.runtime_env,
        },
    )


def run_code(code: str, language: str, session: EmulatorSession | None = None) -> dict:
    if not _semaphore.acquire(blocking=False):
        raise ValueError("Too many concurrent executions. Try again later.")

    runtime, exec_id, filename, encoded = _build_exec_context(code, language)
    start = time.time()
    container = None

    logger.info("execution started | exec_id=%s language=%s", exec_id, language)

    try:
        container = _start_container(
            runtime,
            command=[
                "sh",
                "-c",
                f"echo {encoded} | base64 -d > {filename} && {' '.join(runtime['cmd'](filename))}",
            ],
            session=session,
        )

        wait_result = container.wait(timeout=LIMITS["time"])
        exit_code: int = wait_result["StatusCode"]
        stdout = _truncate(container.logs(stdout=True, stderr=False))
        stderr = _truncate(container.logs(stdout=False, stderr=True))

        logger.info(
            "execution finished | exec_id=%s exit_code=%d duration_ms=%d",
            exec_id,
            exit_code,
            int((time.time() - start) * 1000),
        )
        return _build_result(exec_id, stdout, stderr, exit_code, False, start)

    except requests.exceptions.ReadTimeout:
        logger.warning(
            "execution timed out | exec_id=%s language=%s limit_s=%d",
            exec_id,
            language,
            LIMITS["time"],
        )
        if container is not None:
            try:
                container.kill()
            except Exception:
                logger.debug(
                    "kill after timeout failed | exec_id=%s", exec_id, exc_info=True
                )
        return _build_result(
            exec_id,
            "",
            f"Execution exceeded the {LIMITS['time']}s time limit.",
            -1,
            True,
            start,
        )

    finally:
        _semaphore.release()
        if container is not None:
            _cleanup_container(container, exec_id)


async def stream_code(
    code: str, language: str, session: EmulatorSession | None = None
) -> AsyncGenerator[bytes]:
    if not _semaphore.acquire(blocking=False):
        raise ValueError("Too many concurrent executions. Try again later.")

    runtime, exec_id, filename, encoded = _build_exec_context(code, language)
    container = None
    loop = asyncio.get_event_loop()
    queue: asyncio.Queue[bytes | None] = asyncio.Queue()

    logger.info("stream started | exec_id=%s language=%s", exec_id, language)

    try:
        container = _start_container(
            runtime,
            command=[
                "sh",
                "-c",
                f"echo {encoded} | base64 -d > {filename} && {' '.join(runtime['unbuffered_cmd'](filename))}",
            ],
            session=session,
        )

        def _kill_on_timeout() -> None:
            """Called by the Timer thread when the execution time limit is exceeded."""
            try:
                container.kill()
            except Exception:
                logger.debug("timeout kill failed | exec_id=%s", exec_id, exc_info=True)

        timer = threading.Timer(LIMITS["time"], _kill_on_timeout)
        timer.start()

        def _pump() -> None:
            """Background thread: reads Docker log chunks, splits on newlines, and feeds complete lines into the asyncio queue."""
            buf = b""
            try:
                for chunk in container.logs(stream=True, follow=True):
                    buf += chunk
                    while b"\n" in buf:
                        line, buf = buf.split(b"\n", 1)
                        loop.call_soon_threadsafe(queue.put_nowait, line + b"\n")
                if buf:
                    loop.call_soon_threadsafe(queue.put_nowait, buf)
            except Exception:
                logger.debug("stream pump error | exec_id=%s", exec_id, exc_info=True)
            finally:
                timer.cancel()
                loop.call_soon_threadsafe(queue.put_nowait, None)

        threading.Thread(target=_pump, daemon=True).start()

        while True:
            line = await queue.get()
            if line is None:
                break
            yield line

    finally:
        _semaphore.release()
        if container is not None:
            _cleanup_container(container, exec_id)
