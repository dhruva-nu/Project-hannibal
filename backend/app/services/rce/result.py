import time

from .config import OUTPUT_CAP_BYTES


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


def _truncate(raw: bytes) -> str:
    if len(raw) > OUTPUT_CAP_BYTES:
        return raw[:OUTPUT_CAP_BYTES].decode(errors="replace") + "\n[output truncated]"
    return raw.decode(errors="replace")
