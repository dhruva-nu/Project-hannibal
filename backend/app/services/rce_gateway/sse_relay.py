"""Relay RCE stream events to the browser as Server-Sent Events.

Formats each event dict as a ``data:`` frame, byte-compatible with the pre-split
SSE stream. Transport failures from the client become a single ``error`` event
so the frontend's stream handler ends cleanly instead of hanging.
"""

import json
import logging
from collections.abc import AsyncGenerator

from .client import RceQueueClient
from .errors import RceSaturated, RceServiceError, RceUnavailable

logger = logging.getLogger(__name__)


def _frame(event: dict) -> str:
    return f"data: {json.dumps(event)}\n\n"


async def stream_sse(
    client: RceQueueClient, code: str, language: str
) -> AsyncGenerator[str]:
    try:
        async for event in client.stream(code, language):
            yield _frame(event)
    except (RceSaturated, RceUnavailable, RceServiceError) as exc:
        yield _frame({"event_type": "error", "exec_id": "", "message": str(exc)})
    except Exception:
        logger.exception("stream relay failed | language=%s", language)
        yield _frame(
            {
                "event_type": "error",
                "exec_id": "",
                "message": "Execution service error.",
            }
        )
