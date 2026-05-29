"""Tests for POST /rce/execute, POST /run-code/run-simple, rce service, and rce schemas."""
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import docker
import pytest
import requests.exceptions
from fastapi.testclient import TestClient

import app.services.rce.docker as rce_docker
from app.services.rce.config import OUTPUT_CAP_BYTES, RUNTIME
from app.dependencies.auth import require_auth
from app.dependencies.build_block import get_build_block_service
from app.main import app
from app.schemas.build_block import BuildBlockResponse

client = TestClient(app)

_AUTH_USER = {"email": "test@example.com", "sub": "1"}
_EXECUTE_URL = "/api/v1/rce/execute"
_RUN_SIMPLE_URL = "/api/v1/run-code/run-simple"


@pytest.fixture(autouse=True)
def reset_state():
    original_client = rce_docker._client
    yield
    rce_docker._client = original_client
    app.dependency_overrides.clear()


def _override_auth():
    app.dependency_overrides[require_auth] = lambda: _AUTH_USER


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
    mock_svc = MagicMock()
    mock_svc.get_block = AsyncMock(return_value=block)
    app.dependency_overrides[get_build_block_service] = lambda: mock_svc
    return mock_svc


def _mock_docker(mocker, *, wait_result=None, logs_side_effect=None, run_raises=None):
    mock_container = MagicMock()
    if run_raises:
        mock_client = MagicMock()
        mock_client.containers.run.side_effect = run_raises
    else:
        mock_container.wait.return_value = wait_result or {"StatusCode": 0}
        mock_container.logs.side_effect = logs_side_effect or [b"output\n", b""]
        mock_client = MagicMock()
        mock_client.containers.run.return_value = mock_container

    mocker.patch("app.services.rce.docker._get_client", return_value=mock_client)
    return mock_container, mock_client


# ── /rce/execute controller ────────────────────────────────────────────────────

class TestExecuteEndpoint:
    def test_unauthenticated_returns_401(self):
        resp = client.post(_EXECUTE_URL, json={"code": "print(1)", "language": "python"})
        assert resp.status_code == 401

    def test_unsupported_language_returns_400(self, mocker):
        _override_auth()
        resp = client.post(_EXECUTE_URL, json={"code": "print(1)", "language": "brainfuck"})
        assert resp.status_code == 400
        assert "brainfuck" in resp.json()["detail"]

    def test_capacity_exceeded_returns_429(self, mocker):
        _override_auth()
        mocker.patch.object(rce_docker._semaphore, "acquire", return_value=False)
        resp = client.post(_EXECUTE_URL, json={"code": "print(1)", "language": "python"})
        assert resp.status_code == 429

    def test_docker_error_returns_500(self, mocker):
        _override_auth()
        _mock_docker(mocker, run_raises=docker.errors.DockerException("daemon unavailable"))
        resp = client.post(_EXECUTE_URL, json={"code": "print(1)", "language": "python"})
        assert resp.status_code == 500

    def test_successful_python_execution(self, mocker):
        _override_auth()
        _mock_docker(mocker, wait_result={"StatusCode": 0}, logs_side_effect=[b"hello\n", b""])
        resp = client.post(_EXECUTE_URL, json={"code": "print('hello')", "language": "python"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["language"] == "python"
        assert body["stdout"] == "hello\n"
        assert body["stderr"] == ""
        assert body["exit_code"] == 0
        assert body["timed_out"] is False

    def test_successful_javascript_execution(self, mocker):
        _override_auth()
        _mock_docker(mocker, wait_result={"StatusCode": 0}, logs_side_effect=[b"hi\n", b""])
        resp = client.post(_EXECUTE_URL, json={"code": "console.log('hi')", "language": "javascript"})
        assert resp.status_code == 200
        assert resp.json()["language"] == "javascript"

    def test_language_is_lowercased(self, mocker):
        _override_auth()
        _mock_docker(mocker, wait_result={"StatusCode": 0}, logs_side_effect=[b"", b""])
        resp = client.post(_EXECUTE_URL, json={"code": "print(1)", "language": "Python"})
        assert resp.status_code == 200
        assert resp.json()["language"] == "python"

    def test_timed_out_response(self, mocker):
        _override_auth()
        mock_container = MagicMock()
        mock_container.wait.side_effect = requests.exceptions.ReadTimeout()
        mock_client = MagicMock()
        mock_client.containers.run.return_value = mock_container
        mocker.patch("app.services.rce.docker._get_client", return_value=mock_client)

        resp = client.post(_EXECUTE_URL, json={"code": "import time; time.sleep(100)", "language": "python"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["timed_out"] is True
        assert body["exit_code"] == -1


# ── /run-code/run-simple controller ───────────────────────────────────────────

class TestRunSimpleEndpoint:
    _BLOCK_ID = str(uuid4())

    def _payload(self, **overrides):
        return {"code": "print(1)", "language": "python", "block_id": self._BLOCK_ID, **overrides}

    def test_unauthenticated_returns_401(self):
        resp = client.post(_RUN_SIMPLE_URL, json=self._payload())
        assert resp.status_code == 401

    def test_unsupported_language_returns_400(self):
        _override_auth()
        resp = client.post(_RUN_SIMPLE_URL, json=self._payload(language="brainfuck"))
        assert resp.status_code == 400
        assert "brainfuck" in resp.json()["detail"]

    def test_code_too_long_returns_422(self):
        _override_auth()
        resp = client.post(_RUN_SIMPLE_URL, json=self._payload(code="x" * 65_537))
        assert resp.status_code == 422

    def test_capacity_exceeded_returns_429(self, mocker):
        _override_auth()
        _mock_build_block_service()
        mocker.patch.object(rce_docker._semaphore, "acquire", return_value=False)
        resp = client.post(_RUN_SIMPLE_URL, json=self._payload())
        assert resp.status_code == 429

    def test_block_fetch_error_returns_500(self):
        _override_auth()
        mock_svc = MagicMock()
        mock_svc.get_block = AsyncMock(side_effect=RuntimeError("db down"))
        app.dependency_overrides[get_build_block_service] = lambda: mock_svc
        resp = client.post(_RUN_SIMPLE_URL, json=self._payload())
        assert resp.status_code == 500

    def test_docker_error_returns_500(self, mocker):
        _override_auth()
        _mock_build_block_service()
        _mock_docker(mocker, run_raises=docker.errors.DockerException("daemon unavailable"))
        resp = client.post(_RUN_SIMPLE_URL, json=self._payload())
        assert resp.status_code == 500

    def test_successful_execution_returns_200(self, mocker):
        _override_auth()
        _mock_build_block_service()
        _mock_docker(mocker, wait_result={"StatusCode": 0}, logs_side_effect=[b"hello\n", b""])
        resp = client.post(_RUN_SIMPLE_URL, json=self._payload(code="print('hello')"))
        assert resp.status_code == 200
        body = resp.json()
        assert body["language"] == "python"
        assert body["block_id"] == self._BLOCK_ID
        assert body["stdout"] == "hello\n"
        assert body["stderr"] == ""
        assert body["exit_code"] == 0
        assert body["timed_out"] is False

    def test_language_is_lowercased(self, mocker):
        _override_auth()
        _mock_build_block_service()
        _mock_docker(mocker, wait_result={"StatusCode": 0}, logs_side_effect=[b"", b""])
        resp = client.post(_RUN_SIMPLE_URL, json=self._payload(language="Python"))
        assert resp.status_code == 200
        assert resp.json()["language"] == "python"

    def test_timed_out_response(self, mocker):
        _override_auth()
        _mock_build_block_service()
        mock_container = MagicMock()
        mock_container.wait.side_effect = requests.exceptions.ReadTimeout()
        mock_client = MagicMock()
        mock_client.containers.run.return_value = mock_container
        mocker.patch("app.services.rce.docker._get_client", return_value=mock_client)

        resp = client.post(_RUN_SIMPLE_URL, json=self._payload(code="import time; time.sleep(100)"))
        assert resp.status_code == 200
        body = resp.json()
        assert body["timed_out"] is True
        assert body["exit_code"] == -1


# ── service ───────────────────────────────────────────────────────────────────

class TestGetClient:
    def test_creates_client_when_none(self, mocker):
        rce_docker._client = None
        mock = MagicMock()
        mocker.patch("app.services.rce.docker.docker.from_env", return_value=mock)

        result = rce_docker._get_client()

        assert result is mock
        assert rce_docker._client is mock

    def test_returns_cached_client(self, mocker):
        existing = MagicMock()
        rce_docker._client = existing
        patched = mocker.patch("app.services.rce.docker.docker.from_env")

        result = rce_docker._get_client()

        assert result is existing
        patched.assert_not_called()

    def test_pulls_missing_images_on_init(self, mocker):
        rce_docker._client = None
        mock = MagicMock()
        mocker.patch("app.services.rce.docker.docker.from_env", return_value=mock)
        mock.images.get.side_effect = docker.errors.ImageNotFound("not found")

        rce_docker._get_client()

        assert mock.images.pull.call_count == len(RUNTIME)

    def test_skips_pull_when_image_present(self, mocker):
        rce_docker._client = None
        mock = MagicMock()
        mocker.patch("app.services.rce.docker.docker.from_env", return_value=mock)

        rce_docker._get_client()

        mock.images.pull.assert_not_called()


class TestRunCode:
    def test_success_returns_correct_fields(self, mocker):
        mock_container, _ = _mock_docker(
            mocker, wait_result={"StatusCode": 0}, logs_side_effect=[b"out\n", b"err\n"]
        )

        result = rce_docker.run_code("print('out')", "python")

        assert result["exit_code"] == 0
        assert result["stdout"] == "out\n"
        assert result["stderr"] == "err\n"
        assert result["timed_out"] is False
        assert "exec_id" in result
        assert "duration_ms" in result

    def test_success_cleans_up_container(self, mocker):
        mock_container, _ = _mock_docker(
            mocker, wait_result={"StatusCode": 0}, logs_side_effect=[b"", b""]
        )

        rce_docker.run_code("x=1", "python")

        mock_container.stop.assert_called_once_with(timeout=0)
        mock_container.remove.assert_called_once()

    def test_stdout_truncated_at_cap(self, mocker):
        big = b"x" * (OUTPUT_CAP_BYTES * 2)
        _mock_docker(mocker, wait_result={"StatusCode": 0}, logs_side_effect=[big, b""])

        result = rce_docker.run_code("x=1", "python")

        assert len(result["stdout"]) < len(big)
        assert "[output truncated]" in result["stdout"]

    def test_stderr_truncated_at_cap(self, mocker):
        big = b"e" * (OUTPUT_CAP_BYTES * 2)
        _mock_docker(mocker, wait_result={"StatusCode": 0}, logs_side_effect=[b"", big])

        result = rce_docker.run_code("x=1", "python")

        assert "[output truncated]" in result["stderr"]

    def test_container_runs_with_read_only_and_tmpfs(self, mocker):
        mock_container, mock_client = _mock_docker(
            mocker, wait_result={"StatusCode": 0}, logs_side_effect=[b"", b""]
        )

        rce_docker.run_code("x=1", "python")

        _, kwargs = mock_client.containers.run.call_args
        assert kwargs["read_only"] is True
        assert "/tmp" in kwargs["tmpfs"]

    def test_timeout_sets_timed_out_flag(self, mocker):
        mock_container = MagicMock()
        mock_container.wait.side_effect = requests.exceptions.ReadTimeout()
        mock_client = MagicMock()
        mock_client.containers.run.return_value = mock_container
        mocker.patch("app.services.rce.docker._get_client", return_value=mock_client)

        result = rce_docker.run_code("import time; time.sleep(99)", "python")

        assert result["timed_out"] is True
        assert result["exit_code"] == -1
        assert "time limit" in result["stderr"]

    def test_timeout_kills_container_immediately(self, mocker):
        mock_container = MagicMock()
        mock_container.wait.side_effect = requests.exceptions.ReadTimeout()
        mock_client = MagicMock()
        mock_client.containers.run.return_value = mock_container
        mocker.patch("app.services.rce.docker._get_client", return_value=mock_client)

        rce_docker.run_code("x=1", "python")

        mock_container.kill.assert_called_once()

    def test_timeout_kill_exception_is_silenced(self, mocker):
        mock_container = MagicMock()
        mock_container.wait.side_effect = requests.exceptions.ReadTimeout()
        mock_container.kill.side_effect = Exception("kill failed")
        mock_client = MagicMock()
        mock_client.containers.run.return_value = mock_container
        mocker.patch("app.services.rce.docker._get_client", return_value=mock_client)

        result = rce_docker.run_code("x=1", "python")

        assert result["timed_out"] is True

    def test_timeout_still_cleans_up_container(self, mocker):
        mock_container = MagicMock()
        mock_container.wait.side_effect = requests.exceptions.ReadTimeout()
        mock_client = MagicMock()
        mock_client.containers.run.return_value = mock_container
        mocker.patch("app.services.rce.docker._get_client", return_value=mock_client)

        rce_docker.run_code("x=1", "python")

        mock_container.stop.assert_called_once_with(timeout=0)
        mock_container.remove.assert_called_once()

    def test_cleanup_errors_are_silenced(self, mocker):
        mock_container = MagicMock()
        mock_container.wait.return_value = {"StatusCode": 0}
        mock_container.logs.side_effect = [b"", b""]
        mock_container.stop.side_effect = Exception("stop failed")
        mock_container.remove.side_effect = Exception("remove failed")
        mock_client = MagicMock()
        mock_client.containers.run.return_value = mock_container
        mocker.patch("app.services.rce.docker._get_client", return_value=mock_client)

        result = rce_docker.run_code("x=1", "python")

        assert result["exit_code"] == 0

    def test_capacity_exceeded_raises_value_error(self, mocker):
        mocker.patch.object(rce_docker._semaphore, "acquire", return_value=False)

        with pytest.raises(ValueError, match="Too many concurrent"):
            rce_docker.run_code("x=1", "python")

    def test_capacity_exceeded_does_not_release_semaphore(self, mocker):
        mocker.patch.object(rce_docker._semaphore, "acquire", return_value=False)
        mock_release = mocker.patch.object(rce_docker._semaphore, "release")

        with pytest.raises(ValueError):
            rce_docker.run_code("x=1", "python")

        mock_release.assert_not_called()

    def test_docker_error_propagates_and_skips_container_cleanup(self, mocker):
        mock_client = MagicMock()
        mock_client.containers.run.side_effect = docker.errors.DockerException("no daemon")
        mocker.patch("app.services.rce.docker._get_client", return_value=mock_client)

        with pytest.raises(docker.errors.DockerException):
            rce_docker.run_code("x=1", "python")

    def test_semaphore_released_after_docker_error(self, mocker):
        mock_client = MagicMock()
        mock_client.containers.run.side_effect = docker.errors.DockerException("no daemon")
        mocker.patch("app.services.rce.docker._get_client", return_value=mock_client)
        mock_release = mocker.patch.object(rce_docker._semaphore, "release")

        with pytest.raises(docker.errors.DockerException):
            rce_docker.run_code("x=1", "python")

        mock_release.assert_called_once()

    def test_nonzero_exit_code_is_preserved(self, mocker):
        _mock_docker(mocker, wait_result={"StatusCode": 1}, logs_side_effect=[b"", b"NameError\n"])

        result = rce_docker.run_code("raise ValueError()", "python")

        assert result["exit_code"] == 1
        assert result["timed_out"] is False
