"""DI for the RCE queue client.

The client owns a long-lived RabbitMQ connection opened in the app lifespan and
stored on ``app.state``; controllers depend on this getter so tests can override
it with a fake via ``app.dependency_overrides``.
"""

from fastapi import Request

from app.services.rce_gateway.client import RceQueueClient


def get_rce_client(request: Request) -> RceQueueClient:
    return request.app.state.rce_client
