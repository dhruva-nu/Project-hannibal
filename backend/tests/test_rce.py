"""Tests for POST /rce/execute, rce_service, and rce schemas."""
from unittest.mock import MagicMock

import docker
import pytest
import requests.exceptions
from fastapi.testclient import TestClient

import app.services.rce_service as rce_service
from app.dependencies.auth import require_auth
from app.main import app

client = TestClient(app)

_AUTH_USER = {"email": "test@example.com", "sub": "1"}
_EXECUTE_URL = "/api/v1/rce/execute"


@pytest.fixture(autouse=True)
def reset_state():
    original_client = rce_service._client
    yield
    rce_service._client = original_client
    app.dependency_overrides.clear()


def _override_auth():
    app.dependency_overrides[require_auth] = lambda: _AUTH_USER


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

    mocker.patch("app.services.rce_service._get_client", return_value=mock_client)
    return mock_container, mock_client


# ── controller ────────────────────────────────────────────────────────────────

class TestExecuteEndpoint:
    def test_unauthenticated_returns_401(self):
        resp = client.post(_EXECUTE_URL, json={"code": "print(1)", "language": "python"})
        assert resp.status_code == 401

    def test_unsupported_language_returns_400(self, mocker):
        _override_auth()
        resp = client.post(_EXECUTE_URL, json={"code": "print(1)", "language": "brainfuck"})
        assert resp.status_code == 400
        assert "brainfuck" in resp.json()["detail"]

    def test_code_too_long_returns_422(self):
        _override_auth()
        resp = client.post(
            _EXECUTE_URL,
            json={"code": "x" * 65_537, "language": "python"},
        )
        assert resp.status_code == 422

    def test_capacity_exceeded_returns_429(self, mocker):
        _override_auth()
        mocker.patch.object(rce_service._semaphore, "acquire", return_value=False)
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
        _mock_docker(
            mocker,
            wait_result={"StatusCode": 0},
            logs_side_effect=[b"hi\n", b""],
        )
        resp = client.post(
            _EXECUTE_URL,
            json={"code": "console.log('hi')", "language": "javascript"},
        )
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
        mocker.patch("app.services.rce_service._get_client", return_value=mock_client)

        resp = client.post(
            _EXECUTE_URL,
            json={"code": "import time; time.sleep(100)", "language": "python"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["timed_out"] is True
        assert body["exit_code"] == -1


# ── service ───────────────────────────────────────────────────────────────────

class TestGetClient:
    def test_creates_client_when_none(self, mocker):
        rce_service._client = None
        mock = MagicMock()
        mocker.patch("app.services.rce_service.docker.from_env", return_value=mock)

        result = rce_service._get_client()

        assert result is mock
        assert rce_service._client is mock

    def test_returns_cached_client(self, mocker):
        existing = MagicMock()
        rce_service._client = existing
        patched = mocker.patch("app.services.rce_service.docker.from_env")

        result = rce_service._get_client()

        assert result is existing
        patched.assert_not_called()


class TestRunCode:
    def test_success_returns_correct_fields(self, mocker):
        mock_container, _ = _mock_docker(
            mocker, wait_result={"StatusCode": 0}, logs_side_effect=[b"out\n", b"err\n"]
        )

        result = rce_service.run_code("print('out')", "python")

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

        rce_service.run_code("x=1", "python")

        mock_container.stop.assert_called_once()
        mock_container.remove.assert_called_once()

    def test_timeout_sets_timed_out_flag(self, mocker):
        mock_container = MagicMock()
        mock_container.wait.side_effect = requests.exceptions.ReadTimeout()
        mock_client = MagicMock()
        mock_client.containers.run.return_value = mock_container
        mocker.patch("app.services.rce_service._get_client", return_value=mock_client)

        result = rce_service.run_code("import time; time.sleep(99)", "python")

        assert result["timed_out"] is True
        assert result["exit_code"] == -1
        assert "time limit" in result["stderr"]

    def test_timeout_still_cleans_up_container(self, mocker):
        mock_container = MagicMock()
        mock_container.wait.side_effect = requests.exceptions.ReadTimeout()
        mock_client = MagicMock()
        mock_client.containers.run.return_value = mock_container
        mocker.patch("app.services.rce_service._get_client", return_value=mock_client)

        rce_service.run_code("x=1", "python")

        mock_container.stop.assert_called_once()
        mock_container.remove.assert_called_once()

    def test_cleanup_errors_are_silenced(self, mocker):
        mock_container = MagicMock()
        mock_container.wait.return_value = {"StatusCode": 0}
        mock_container.logs.side_effect = [b"", b""]
        mock_container.stop.side_effect = Exception("stop failed")
        mock_container.remove.side_effect = Exception("remove failed")
        mock_client = MagicMock()
        mock_client.containers.run.return_value = mock_container
        mocker.patch("app.services.rce_service._get_client", return_value=mock_client)

        result = rce_service.run_code("x=1", "python")

        assert result["exit_code"] == 0

    def test_capacity_exceeded_raises_value_error(self, mocker):
        mocker.patch.object(rce_service._semaphore, "acquire", return_value=False)

        with pytest.raises(ValueError, match="Too many concurrent"):
            rce_service.run_code("x=1", "python")

    def test_capacity_exceeded_does_not_release_semaphore(self, mocker):
        mocker.patch.object(rce_service._semaphore, "acquire", return_value=False)
        mock_release = mocker.patch.object(rce_service._semaphore, "release")

        with pytest.raises(ValueError):
            rce_service.run_code("x=1", "python")

        mock_release.assert_not_called()

    def test_docker_error_propagates_and_skips_cleanup(self, mocker):
        mock_client = MagicMock()
        mock_client.containers.run.side_effect = docker.errors.DockerException("no daemon")
        mocker.patch("app.services.rce_service._get_client", return_value=mock_client)

        with pytest.raises(docker.errors.DockerException):
            rce_service.run_code("x=1", "python")

    def test_semaphore_released_after_docker_error(self, mocker):
        mock_client = MagicMock()
        mock_client.containers.run.side_effect = docker.errors.DockerException("no daemon")
        mocker.patch("app.services.rce_service._get_client", return_value=mock_client)
        mock_release = mocker.patch.object(rce_service._semaphore, "release")

        with pytest.raises(docker.errors.DockerException):
            rce_service.run_code("x=1", "python")

        mock_release.assert_called_once()

    def test_nonzero_exit_code_is_preserved(self, mocker):
        _mock_docker(
            mocker, wait_result={"StatusCode": 1}, logs_side_effect=[b"", b"NameError\n"]
        )

        result = rce_service.run_code("raise ValueError()", "python")

        assert result["exit_code"] == 1
        assert result["timed_out"] is False
