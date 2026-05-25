import base64
import logging
import threading
import uuid
import time
from typing import Optional

import docker
import requests.exceptions

from .config import RUNTIME, LIMITS, OUTPUT_CAP_BYTES
from .result import _build_result, _truncate

logger = logging.getLogger(__name__)

_client: Optional[docker.DockerClient] = None
_client_lock = threading.Lock()
# _semaphore cap (5) × pids_limit (10) = 50 host PIDs max from this service
_semaphore = threading.Semaphore(5)


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


def run_code(code: str, language: str) -> dict:
    if not _semaphore.acquire(blocking=False):
        raise ValueError("Too many concurrent executions. Try again later.")

    runtime = RUNTIME[language]
    exec_id = str(uuid.uuid4())
    filename = f"/tmp/{exec_id}.{runtime['ext']}"
    encoded = base64.b64encode(code.encode()).decode()
    start = time.time()
    container = None

    logger.info("execution started | exec_id=%s language=%s", exec_id, language)

    try:
        container = _get_client().containers.run(
            image=runtime["image"],
            command=[
                "sh",
                "-c",
                f"echo {encoded} | base64 -d > {filename} && {' '.join(runtime['cmd'](filename))}",
            ],
            detach=True,
            network_mode="none",
            mem_limit=LIMITS["memory"],
            memswap_limit=LIMITS["memory"],
            pids_limit=LIMITS["pid"],
            cap_drop=["ALL"],
            security_opt=["no-new-privileges"],
            user="65534:65534",
            read_only=True,
            tmpfs={"/tmp": "size=64m,mode=1777"},
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
                logger.debug("kill after timeout failed | exec_id=%s", exec_id, exc_info=True)
        return _build_result(
            exec_id, "", f"Execution exceeded the {LIMITS['time']}s time limit.", -1, True, start
        )

    finally:
        _semaphore.release()
        if container is not None:
            try:
                container.stop(timeout=0)
            except Exception:
                logger.debug("container.stop failed | exec_id=%s", exec_id, exc_info=True)
            try:
                container.remove()
            except Exception:
                logger.debug("container.remove failed | exec_id=%s", exec_id, exc_info=True)
