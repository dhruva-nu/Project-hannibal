import base64
import logging
import uuid
import time

import docker

logger = logging.getLogger(__name__)

RUNTIME: dict[str, dict] = {
    "python": {
        "image": "python:3.11-alpine",
        "cmd": lambda f: ["python3", f],
        "ext": "py",
    },
    "javascript": {
        "image": "node:20-alpine",
        "cmd": lambda f: ["node", f],
        "ext": "js",
    },
}

LIMITS = {
    "time": 10,  # seconds
    "memory": 128 * 1024**2,  # 128 MB
    "pid": 10,
}


def _build_result(
    exec_id: str,
    stdout: str,
    stderr: str,
    exit_code: int,
    timed_out: bool,
    start: float,
) -> dict:
    return {
        "exec_id": exec_id,
        "stdout": stdout,
        "stderr": stderr,
        "exit_code": exit_code,
        "timed_out": timed_out,
        "duration_ms": int((time.time() - start) * 1000),
    }


def run_code(code: str, language: str) -> dict:
    client = docker.from_env()
    runtime = RUNTIME[language]
    exec_id = str(uuid.uuid4())
    filename = f"/tmp/{exec_id}.{runtime['ext']}"
    encoded = base64.b64encode(code.encode()).decode()
    start = time.time()
    container = None

    logger.info("execution started | exec_id=%s language=%s", exec_id, language)

    try:
        container = client.containers.run(
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
        )

        wait_result = container.wait(timeout=LIMITS["time"])
        exit_code: int = wait_result["StatusCode"]
        stdout = container.logs(stdout=True, stderr=False).decode()
        stderr = container.logs(stdout=False, stderr=True).decode()

        logger.info(
            "execution finished | exec_id=%s exit_code=%d duration_ms=%d",
            exec_id,
            exit_code,
            int((time.time() - start) * 1000),
        )
        return _build_result(exec_id, stdout, stderr, exit_code, False, start)

    except Exception:
        logger.warning(
            "execution timed out | exec_id=%s language=%s limit_s=%d",
            exec_id,
            language,
            LIMITS["time"],
        )
        return _build_result(
            exec_id, "", f"Execution exceeded the {LIMITS['time']}s time limit.", -1, True, start
        )

    finally:
        if container is not None:
            try:
                container.stop()
            except Exception:
                pass
            try:
                container.remove()
            except Exception:
                pass
