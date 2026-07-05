"""Mapping typed dependency failures to structured responses (SUB6 of #103).

A disallowed import or a failed install is a fact about the sandbox, not a
crash — so it comes back as ``dependency_error {package, reason, kind}`` on a
normal 200 response (or a ``dependency_error`` stream event), never as a raw
traceback or an opaque 4xx the frontend can only log.
"""

import uuid

from app.exception.rce_exception import DependencyInstallError, UnpermittedDependency

DependencyFailure = UnpermittedDependency | DependencyInstallError

_REASON_CAP = 300  # install stderr can be huge; the student needs the gist


def dependency_error_info(exc: DependencyFailure) -> dict:
    """The ``{package, reason, kind}`` payload shared by response and stream."""
    if isinstance(exc, UnpermittedDependency):
        return {"package": exc.package, "reason": str(exc), "kind": "not_allowed"}
    return {
        "package": ", ".join(exc.packages),
        "reason": str(exc)[:_REASON_CAP],
        "kind": "install_failed",
    }


def dependency_error_result(exc: DependencyFailure) -> dict:
    """A full execution-result payload for a run that never started."""
    return {
        "exec_id": str(uuid.uuid4()),
        "exit_code": -1,
        "stdout": "",
        "stderr": "",
        "timed_out": False,
        "duration_ms": 0,
        "dependency_error": dependency_error_info(exc),
    }
