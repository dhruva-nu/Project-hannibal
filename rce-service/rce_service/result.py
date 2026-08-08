import time

from .config import OUTPUT_CAP_BYTES


def _build_result(
    exec_id: str,
    stdout: str,
    stderr: str,
    exit_code: int,
    timed_out: bool,
    start: float,
    emu_oplog: list[dict] | None = None,
) -> dict:
    """The execution outcome, plus the op log when the lesson had emulators.

    ``emu_oplog`` is what lets a lesson grade *behaviour* — "did they retry the
    failed commit?" — instead of stdout. It is absent rather than empty for a run
    that declared no emulators, so "no emulators" and "emulators nothing touched"
    stay distinguishable.
    """
    return {
        "exec_id": exec_id,
        "stdout": stdout,
        "stderr": stderr,
        "exit_code": exit_code,
        "timed_out": timed_out,
        "duration_ms": int((time.time() - start) * 1000),
        "emu_oplog": emu_oplog,
    }


def _truncate(raw: bytes) -> str:
    if len(raw) > OUTPUT_CAP_BYTES:
        return raw[:OUTPUT_CAP_BYTES].decode(errors="replace") + "\n[output truncated]"
    return raw.decode(errors="replace")
