"""Transport-level failures the gateway raises; controllers map them to HTTP.

Dependency failures are NOT here — those come back as a normal result with a
``dependency_error`` payload (HTTP 200), exactly as before the split.
"""

from fastapi import HTTPException


class RceSaturated(Exception):
    """Too many concurrent executions — the broker rejected the job (→ 429)."""


class RceTimeout(Exception):
    """No reply within the RPC deadline; the worker is dead or wedged (→ 504)."""


class RceUnavailable(Exception):
    """The broker is unreachable (→ 503)."""


class RceServiceError(Exception):
    """The worker reported an unexpected internal failure (→ 500)."""


def raise_for_transport_error(exc: RceSaturated | RceTimeout | RceUnavailable) -> None:
    """Raise the HTTPException a controller should return for a transport failure.

    Shared by every RCE-fronting controller so each one only owns the
    ``RceServiceError`` branch, which has endpoint-specific logging/detail.
    """
    if isinstance(exc, RceSaturated):
        raise HTTPException(status_code=429, detail=str(exc))
    if isinstance(exc, RceTimeout):
        raise HTTPException(status_code=504, detail=str(exc))
    raise HTTPException(status_code=503, detail=str(exc))
