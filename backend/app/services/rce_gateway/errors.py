"""Transport-level failures the gateway raises; controllers map them to HTTP.

Dependency failures are NOT here — those come back as a normal result with a
``dependency_error`` payload (HTTP 200), exactly as before the split.
"""


class RceSaturated(Exception):
    """Too many concurrent executions — the broker rejected the job (→ 429)."""


class RceTimeout(Exception):
    """No reply within the RPC deadline; the worker is dead or wedged (→ 504)."""


class RceUnavailable(Exception):
    """The broker is unreachable (→ 503)."""


class RceServiceError(Exception):
    """The worker reported an unexpected internal failure (→ 500)."""
