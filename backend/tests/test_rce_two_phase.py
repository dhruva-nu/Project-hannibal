"""Tests for two-phase orchestration (SUB5).

The prepare step (resolve → ensure cache) in front of every execution path,
and the run container's unchanged lockdown plus its two dependency-related
additions: a read-only cache mount and the resolution env var.
"""

import json
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.dependencies.auth import require_auth
from app.dependencies.build_block import get_build_block_service
from app.exception.rce_exception import DependencyInstallError, UnpermittedDependency
from app.main import app
from app.schemas.build_block import BuildBlockResponse
from app.services.rce import two_phase
from app.services.rce.config import RUNTIME
from app.services.rce.deps.cache import run_phase_mounts
from app.services.rce.docker import run_code
from app.services.rce.two_phase import prepare_dependencies

client = TestClient(app)

_AUTH_USER = {"email": "test@example.com", "sub": "1"}
_PY_PROVIDER = RUNTIME["python"]["deps"]


@pytest.fixture(autouse=True)
def reset_overrides():
    app.dependency_overrides[require_auth] = lambda: _AUTH_USER
    yield
    app.dependency_overrides.clear()


def _mock_docker(mocker):
    container = MagicMock()
    container.wait.return_value = {"StatusCode": 0}
    container.logs.side_effect = [b"output\n", b""]
    mock_client = MagicMock()
    mock_client.containers.run.return_value = container
    mocker.patch("app.services.rce.docker._get_client", return_value=mock_client)
    return mock_client


def _mock_build_block_service():
    block = BuildBlockResponse(
        id=uuid4(),
        instructions="",
        input="",
        output="",
        test_code="--user-code--",
        code_template="",
        type="simple_run",
        tests=[],
    )
    service = MagicMock()
    service.get_block = AsyncMock(return_value=block)
    app.dependency_overrides[get_build_block_service] = lambda: service


# ── prepare_dependencies ──────────────────────────────────────────────────────


class TestPrepareDependencies:
    async def test_ensures_resolved_packages_before_the_run(self, mocker):
        ensure = mocker.patch.object(two_phase.install_queue, "ensure", AsyncMock())

        packages = await prepare_dependencies("import numpy", "python")

        assert packages == ["numpy"]
        ensure.assert_awaited_once_with(_PY_PROVIDER, ["numpy"])

    async def test_stdlib_only_code_never_touches_the_queue(self, mocker):
        ensure = mocker.patch.object(two_phase.install_queue, "ensure", AsyncMock())

        assert await prepare_dependencies("import os, json", "python") == []

        ensure.assert_not_awaited()

    async def test_unpermitted_import_raises_before_the_queue(self, mocker):
        ensure = mocker.patch.object(two_phase.install_queue, "ensure", AsyncMock())

        with pytest.raises(UnpermittedDependency) as exc:
            await prepare_dependencies("import leftpad", "python")

        assert exc.value.package == "leftpad"
        ensure.assert_not_awaited()

    async def test_same_path_works_for_javascript(self, mocker):
        ensure = mocker.patch.object(two_phase.install_queue, "ensure", AsyncMock())

        packages = await prepare_dependencies(
            "const a = require('axios')", "javascript"
        )

        assert packages == ["axios"]
        ensure.assert_awaited_once_with(RUNTIME["javascript"]["deps"], ["axios"])


# ── run container posture ─────────────────────────────────────────────────────


class TestRunContainerPosture:
    def test_cache_is_mounted_read_only_with_resolution_env(self, mocker):
        mock_client = _mock_docker(mocker)

        run_code("print(1)", "python")

        kwargs = mock_client.containers.run.call_args.kwargs
        assert kwargs["volumes"] == run_phase_mounts(_PY_PROVIDER)
        assert kwargs["environment"] == {"PYTHONPATH": "/opt/rce-cache/python"}

    def test_lockdown_is_unchanged_by_the_cache_mount(self, mocker):
        mock_client = _mock_docker(mocker)

        run_code("print(1)", "python")

        kwargs = mock_client.containers.run.call_args.kwargs
        assert kwargs["network_mode"] == "none"
        assert kwargs["read_only"] is True
        assert kwargs["cap_drop"] == ["ALL"]
        assert kwargs["user"] == "65534:65534"


# ── endpoints ─────────────────────────────────────────────────────────────────


class TestExecuteEndpoint:
    def test_disallowed_import_is_a_400_naming_the_package(self):
        resp = client.post(
            "/api/v1/rce/execute",
            json={"code": "import leftpad", "language": "python"},
        )
        assert resp.status_code == 400
        assert "leftpad" in resp.json()["detail"]

    def test_install_failure_is_a_502(self, mocker):
        mocker.patch.object(
            two_phase.install_queue,
            "ensure",
            AsyncMock(side_effect=DependencyInstallError(["numpy"], "python", "boom")),
        )
        resp = client.post(
            "/api/v1/rce/execute",
            json={"code": "import numpy", "language": "python"},
        )
        assert resp.status_code == 502

    def test_cached_dependency_runs_normally(self, mocker):
        mocker.patch.object(two_phase.install_queue, "ensure", AsyncMock())
        _mock_docker(mocker)

        resp = client.post(
            "/api/v1/rce/execute",
            json={"code": "import numpy", "language": "python"},
        )

        assert resp.status_code == 200
        assert resp.json()["exit_code"] == 0


class TestStreamEndpoint:
    def test_disallowed_import_streams_an_error_event(self):
        resp = client.post(
            "/api/v1/rce/execute/stream",
            json={"code": "import leftpad", "language": "python"},
        )
        assert resp.status_code == 200
        event = json.loads(resp.text.split("data: ", 1)[1].split("\n")[0])
        assert event["event_type"] == "error"
        assert "leftpad" in event["message"]

    def test_stream_still_streams_after_the_prepare_step(self, mocker):
        mocker.patch.object(two_phase.install_queue, "ensure", AsyncMock())
        container = MagicMock()
        container.logs.return_value = iter([b"hello\n"])
        mock_client = MagicMock()
        mock_client.containers.run.return_value = container
        mocker.patch("app.services.rce.docker._get_client", return_value=mock_client)

        resp = client.post(
            "/api/v1/rce/execute/stream",
            json={"code": "import numpy\nprint('hello')", "language": "python"},
        )

        assert resp.status_code == 200
        event = json.loads(resp.text.split("data: ", 1)[1].split("\n")[0])
        assert event["event_type"] == "stdout"
        assert event["line"] == "hello\n"


class TestRunSimpleEndpoint:
    def test_disallowed_import_is_a_400_naming_the_package(self):
        _mock_build_block_service()
        resp = client.post(
            "/api/v1/run-code/run-simple",
            json={
                "code": "import leftpad",
                "language": "python",
                "block_id": str(uuid4()),
            },
        )
        assert resp.status_code == 400
        assert "leftpad" in resp.json()["detail"]
