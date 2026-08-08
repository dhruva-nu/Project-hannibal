import asyncio
import base64
import logging
import threading
import time
import uuid
from collections.abc import AsyncGenerator

import docker
import requests.exceptions

from . import emu
from .config import LIMITS, RUNTIME
from .deps.cache import run_phase_mounts
from .result import _build_result, _truncate

logger = logging.getLogger(__name__)

_client: docker.DockerClient | None = None
_client_lock = threading.Lock()
# _semaphore cap (5) × pids_limit (32) = 160 host PIDs max from this service
_semaphore = threading.Semaphore(5)

# A lesson's emulator setup, or None when the request declares none. Carried as a
# plain dict: contracts.py owns its shape and emu itself validates its contents.
EmuConfig = dict | None


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


def _decode_into(path: str, encoded: str) -> str:
    """Materialise a base64 payload as a file inside the container's tmpfs.

    Everything a run needs travels inside its own command: rce-service lives in
    a container of its own while driving the *host* daemon, so a path it can
    write is never a path that daemon could bind-mount.
    """
    return f"echo {encoded} | base64 -d > {path}"


def _shell_command(
    runtime: dict,
    filename: str,
    encoded: str,
    emu_config: EmuConfig,
    *,
    unbuffered: bool,
) -> list[str]:
    """The container's whole command: write the inputs, then run the code.

    With emulators declared, the lesson's config lands beside the code and emu
    takes over the process via ``exec`` — so emu is PID 1 and the sandbox
    guarantees measured in ``emu-service/verify-sandbox.sh`` hold. Without them
    the line is character-for-character what it was before emu existed.
    """
    argv = runtime["unbuffered_cmd" if unbuffered else "cmd"](filename)
    steps = [_decode_into(filename, encoded)]
    launch = " ".join(argv)

    if emu_config is not None:
        steps.insert(0, _decode_into(emu.CONFIG_PATH, emu.encode_config(emu_config)))
        launch = "exec " + " ".join(emu.wrap(argv))

    return ["sh", "-c", " && ".join([*steps, launch])]


def _start_container(runtime: dict, command: list[str], emu_config: EmuConfig = None):
    """Run a sandboxed Docker container with standard security constraints.

    The only dependency-related additions are a **read-only** view of the
    language's package cache plus its resolution env var (``PYTHONPATH`` /
    ``NODE_PATH``); every other lockdown is unchanged from the pre-deps
    sandbox. A lesson with emulators adds one more read-only mount and two
    environment variables, and changes nothing else about the posture.
    """
    provider = runtime["deps"]
    volumes = run_phase_mounts(provider)
    environment = provider.runtime_env
    client = _get_client()

    if emu_config is not None:
        emu.ensure_published(client)
        volumes = volumes | emu.mounts()
        environment = environment | emu.ENV

    return client.containers.run(
        image=runtime["image"],
        command=command,
        detach=True,
        network_mode="none",
        mem_limit=LIMITS["memory"],
        memswap_limit=LIMITS["memory"],
        pids_limit=LIMITS["pid"],
        cap_drop=["ALL"],
        security_opt=["no-new-privileges"],
        user="65534:65534",
        read_only=True,
        tmpfs={"/tmp": "size=64m,mode=1777"},  # nosec B108 — sandboxed tmpfs
        volumes=volumes,
        environment=environment,
    )


def _separate_oplog(
    raw_stdout: bytes, emu_config: EmuConfig
) -> tuple[bytes, list | None]:
    """The student's stdout, and the graded artifact, told apart.

    A request with no emulators never had an op log to look for, so its output is
    handed back untouched — the byte-for-byte guarantee that this phase changes
    nothing for the runs that make up all of today's traffic.
    """
    if emu_config is None:
        return raw_stdout, None
    return emu.split_oplog(raw_stdout)


def run_code(code: str, language: str, emu_config: EmuConfig = None) -> dict:
    if not _semaphore.acquire(blocking=False):
        raise ValueError("Too many concurrent executions. Try again later.")

    runtime, exec_id, filename, encoded = _build_exec_context(code, language)
    start = time.time()
    container = None

    logger.info("execution started | exec_id=%s language=%s", exec_id, language)

    try:
        container = _start_container(
            runtime,
            command=_shell_command(
                runtime, filename, encoded, emu_config, unbuffered=False
            ),
            emu_config=emu_config,
        )

        wait_result = container.wait(timeout=LIMITS["time"])
        exit_code: int = wait_result["StatusCode"]
        # Split before truncating, so a chatty program cannot push the op log
        # past the output cap.
        student_stdout, oplog = _separate_oplog(
            container.logs(stdout=True, stderr=False), emu_config
        )
        stdout = _truncate(student_stdout)
        stderr = _truncate(container.logs(stdout=False, stderr=True))

        logger.info(
            "execution finished | exec_id=%s exit_code=%d duration_ms=%d",
            exec_id,
            exit_code,
            int((time.time() - start) * 1000),
        )
        return _build_result(exec_id, stdout, stderr, exit_code, False, start, oplog)

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


def _is_student_output(line: bytes, emu_config: EmuConfig) -> bool:
    """Whether a streamed line belongs to the student rather than to emu.

    Docker merges the streams, so emu's op log would otherwise arrive in the
    browser as one unreadable line of JSON. The graded artifact is not a live
    signal anyway — the verdict comes from the sync ``run-simple`` run, which is
    where the op log is returned.
    """
    return emu_config is None or not emu.is_oplog_line(line)


async def stream_code(
    code: str, language: str, emu_config: EmuConfig = None
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
            command=_shell_command(
                runtime, filename, encoded, emu_config, unbuffered=True
            ),
            emu_config=emu_config,
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
            if _is_student_output(line, emu_config):
                yield line

    finally:
        _semaphore.release()
        if container is not None:
            _cleanup_container(container, exec_id)
