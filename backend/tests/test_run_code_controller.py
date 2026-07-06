"""Tests for POST /run-code/run-simple, driven through a FAKE queue client.

``run-simple`` splices the student code into the build block's test harness
(``add_test_code``) and then hands the combined script to the queue client, so
these tests mock both the build-block service and the RCE client.
"""

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.dependencies.auth import require_auth
from app.dependencies.build_block import get_build_block_service
from app.dependencies.rce import get_rce_client
from app.main import app
from app.schemas.build_block import BuildBlockResponse
from app.services.rce_gateway.errors import (
    RceSaturated,
    RceServiceError,
    RceTimeout,
    RceUnavailable,
)

client = TestClient(app)

_AUTH_USER = {"email": "t@e.st", "sub": "1"}
_RUN_SIMPLE_URL = "/api/v1/run-code/run-simple"


def _result(**overrides) -> dict:
    body = {
        "exec_id": "exec-1",
        "exit_code": 0,
        "stdout": "ok\n",
        "stderr": "",
        "timed_out": False,
        "duration_ms": 5,
        "dependency_error": None,
    }
    body.update(overrides)
    return body


def _mock_build_block_service(test_code: str = "--user-code--"):
    block = BuildBlockResponse(
        id=uuid4(),
        instructions="",
        input="",
        output="",
        test_code=test_code,
        code_template="",
        type="simple_run",
        tests=[],
    )
    service = MagicMock()
    service.get_block = AsyncMock(return_value=block)
    app.dependency_overrides[get_build_block_service] = lambda: service
    return service


@pytest.fixture
def fake():
    fake_client = MagicMock()
    fake_client.execute = AsyncMock()
    app.dependency_overrides[require_auth] = lambda: _AUTH_USER
    app.dependency_overrides[get_rce_client] = lambda: fake_client
    return fake_client


@pytest.fixture(autouse=True)
def reset_overrides():
    yield
    app.dependency_overrides.clear()


def _body(**overrides) -> dict:
    payload = {"code": "print('x')", "language": "python", "block_id": str(uuid4())}
    payload.update(overrides)
    return payload


class TestRunSimpleEndpoint:
    def test_success_returns_run_simple_response(self, fake):
        _mock_build_block_service()
        fake.execute.return_value = _result()
        block_id = str(uuid4())
        resp = client.post(_RUN_SIMPLE_URL, json=_body(block_id=block_id))
        assert resp.status_code == 200
        body = resp.json()
        assert body["language"] == "python"
        assert body["block_id"] == block_id
        assert body["stdout"] == "ok\n"
        assert body["dependency_error"] is None
        fake.execute.assert_awaited_once()

    def test_dependency_error_is_passed_through(self, fake):
        _mock_build_block_service()
        fake.execute.return_value = _result(
            dependency_error={
                "package": "leftpad",
                "reason": "not allowed",
                "kind": "not_allowed",
            }
        )
        resp = client.post(_RUN_SIMPLE_URL, json=_body())
        assert resp.status_code == 200
        assert resp.json()["dependency_error"]["kind"] == "not_allowed"

    def test_splices_user_code_into_test_harness(self, fake):
        _mock_build_block_service(test_code="print('before')\n--user-code--")
        fake.execute.return_value = _result()
        resp = client.post(_RUN_SIMPLE_URL, json=_body(code="print('mine')"))
        assert resp.status_code == 200
        combined = fake.execute.call_args.args[0]
        assert combined == "print('before')\nprint('mine')"

    def test_unsupported_language_returns_400(self, fake):
        _mock_build_block_service()
        resp = client.post(_RUN_SIMPLE_URL, json=_body(language="brainfuck"))
        assert resp.status_code == 400
        assert "brainfuck" in resp.json()["detail"]
        fake.execute.assert_not_awaited()

    def test_missing_placeholder_returns_500(self, fake):
        _mock_build_block_service(test_code="no placeholder here")
        resp = client.post(_RUN_SIMPLE_URL, json=_body())
        assert resp.status_code == 500
        assert resp.json()["detail"] == "Run code service error."
        fake.execute.assert_not_awaited()

    def test_saturated_returns_429(self, fake):
        _mock_build_block_service()
        fake.execute.side_effect = RceSaturated("too busy")
        resp = client.post(_RUN_SIMPLE_URL, json=_body())
        assert resp.status_code == 429

    def test_timeout_returns_504(self, fake):
        _mock_build_block_service()
        fake.execute.side_effect = RceTimeout("slow")
        resp = client.post(_RUN_SIMPLE_URL, json=_body())
        assert resp.status_code == 504

    def test_unavailable_returns_503(self, fake):
        _mock_build_block_service()
        fake.execute.side_effect = RceUnavailable("no broker")
        resp = client.post(_RUN_SIMPLE_URL, json=_body())
        assert resp.status_code == 503

    def test_service_error_returns_500(self, fake):
        _mock_build_block_service()
        fake.execute.side_effect = RceServiceError("boom")
        resp = client.post(_RUN_SIMPLE_URL, json=_body())
        assert resp.status_code == 500
        assert resp.json()["detail"] == "Run code service error."
