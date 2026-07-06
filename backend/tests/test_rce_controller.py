"""Tests for the RCE HTTP endpoints, driven through a FAKE queue client.

The sandbox now lives in a separate microservice reached over RabbitMQ, so the
backend side only needs to prove it maps the queue client's results and
transport errors onto the right HTTP responses.
"""

import json
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from app.dependencies.auth import require_auth
from app.dependencies.rce import get_rce_client
from app.main import app
from app.services.rce_gateway.errors import (
    RceSaturated,
    RceServiceError,
    RceTimeout,
    RceUnavailable,
)

client = TestClient(app)

_AUTH_USER = {"email": "t@e.st", "sub": "1"}
_EXECUTE_URL = "/api/v1/rce/execute"
_STREAM_URL = "/api/v1/rce/execute/stream"


def _result(**overrides) -> dict:
    body = {
        "exec_id": "exec-1",
        "exit_code": 0,
        "stdout": "hello\n",
        "stderr": "",
        "timed_out": False,
        "duration_ms": 12,
        "dependency_error": None,
    }
    body.update(overrides)
    return body


class _FakeClient:
    def __init__(self):
        self.execute = AsyncMock()
        self._stream_events: list[dict] = []
        self._stream_raises: Exception | None = None

    def stream(self, code: str, language: str):
        events = self._stream_events
        raises = self._stream_raises

        async def gen():
            if raises is not None:
                raise raises
            for event in events:
                yield event

        return gen()


@pytest.fixture
def fake():
    fake_client = _FakeClient()
    app.dependency_overrides[require_auth] = lambda: _AUTH_USER
    app.dependency_overrides[get_rce_client] = lambda: fake_client
    return fake_client


@pytest.fixture(autouse=True)
def reset_overrides():
    yield
    app.dependency_overrides.clear()


class TestExecuteEndpoint:
    def test_success_returns_execute_response(self, fake):
        fake.execute.return_value = _result()
        resp = client.post(
            _EXECUTE_URL, json={"code": "print('hi')", "language": "python"}
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["language"] == "python"
        assert body["exec_id"] == "exec-1"
        assert body["stdout"] == "hello\n"
        assert body["dependency_error"] is None
        fake.execute.assert_awaited_once_with("print('hi')", "python")

    def test_dependency_error_is_passed_through(self, fake):
        fake.execute.return_value = _result(
            dependency_error={
                "package": "leftpad",
                "reason": "not on the allowlist",
                "kind": "not_allowed",
            }
        )
        resp = client.post(
            _EXECUTE_URL, json={"code": "import leftpad", "language": "python"}
        )
        assert resp.status_code == 200
        assert resp.json()["dependency_error"]["package"] == "leftpad"

    def test_language_is_lowercased(self, fake):
        fake.execute.return_value = _result()
        resp = client.post(
            _EXECUTE_URL, json={"code": "print(1)", "language": "PYTHON"}
        )
        assert resp.status_code == 200
        fake.execute.assert_awaited_once_with("print(1)", "python")

    def test_unsupported_language_returns_400(self, fake):
        resp = client.post(
            _EXECUTE_URL, json={"code": "print(1)", "language": "brainfuck"}
        )
        assert resp.status_code == 400
        assert "brainfuck" in resp.json()["detail"]
        fake.execute.assert_not_awaited()

    def test_saturated_returns_429(self, fake):
        fake.execute.side_effect = RceSaturated("too busy")
        resp = client.post(
            _EXECUTE_URL, json={"code": "print(1)", "language": "python"}
        )
        assert resp.status_code == 429
        assert resp.json()["detail"] == "too busy"

    def test_timeout_returns_504(self, fake):
        fake.execute.side_effect = RceTimeout("slow")
        resp = client.post(
            _EXECUTE_URL, json={"code": "print(1)", "language": "python"}
        )
        assert resp.status_code == 504

    def test_unavailable_returns_503(self, fake):
        fake.execute.side_effect = RceUnavailable("no broker")
        resp = client.post(
            _EXECUTE_URL, json={"code": "print(1)", "language": "python"}
        )
        assert resp.status_code == 503

    def test_service_error_returns_500(self, fake):
        fake.execute.side_effect = RceServiceError("boom")
        resp = client.post(
            _EXECUTE_URL, json={"code": "print(1)", "language": "python"}
        )
        assert resp.status_code == 500
        assert resp.json()["detail"] == "Execution service error."


def _parse_sse(text: str) -> list[dict]:
    return [
        json.loads(frame[len("data: ") :])
        for frame in text.strip().split("\n\n")
        if frame.startswith("data: ")
    ]


class TestStreamEndpoint:
    def test_stream_relays_events(self, fake):
        fake._stream_events = [
            {"event_type": "stdout", "exec_id": "e1", "line": "hi\n"},
            {
                "event_type": "dependency_error",
                "exec_id": "e1",
                "package": "leftpad",
            },
        ]
        resp = client.post(_STREAM_URL, json={"code": "print(1)", "language": "python"})
        assert resp.status_code == 200
        events = _parse_sse(resp.text)
        assert events[0]["event_type"] == "stdout"
        assert events[0]["line"] == "hi\n"
        assert events[1]["event_type"] == "dependency_error"
        assert events[1]["package"] == "leftpad"

    def test_stream_unsupported_language_returns_400(self, fake):
        resp = client.post(_STREAM_URL, json={"code": "print(1)", "language": "cobol"})
        assert resp.status_code == 400
