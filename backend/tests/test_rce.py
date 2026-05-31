"""Tests for POST /rce/execute, POST /run-code/run-simple, rce service, and rce schemas."""

import json
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
_EXECUTE_STREAM_URL = "/api/v1/rce/execute/stream"
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
        resp = client.post(
            _EXECUTE_URL, json={"code": "print(1)", "language": "python"}
        )
        assert resp.status_code == 401

    def test_unsupported_language_returns_400(self, mocker):
        _override_auth()
        resp = client.post(
            _EXECUTE_URL, json={"code": "print(1)", "language": "brainfuck"}
        )
        assert resp.status_code == 400
        assert "brainfuck" in resp.json()["detail"]

    def test_capacity_exceeded_returns_429(self, mocker):
        _override_auth()
        mocker.patch.object(rce_docker._semaphore, "acquire", return_value=False)
        resp = client.post(
            _EXECUTE_URL, json={"code": "print(1)", "language": "python"}
        )
        assert resp.status_code == 429

    def test_docker_error_returns_500(self, mocker):
        _override_auth()
        _mock_docker(
            mocker, run_raises=docker.errors.DockerException("daemon unavailable")
        )
        resp = client.post(
            _EXECUTE_URL, json={"code": "print(1)", "language": "python"}
        )
        assert resp.status_code == 500

    def test_successful_python_execution(self, mocker):
        _override_auth()
        _mock_docker(
            mocker, wait_result={"StatusCode": 0}, logs_side_effect=[b"hello\n", b""]
        )
        resp = client.post(
            _EXECUTE_URL, json={"code": "print('hello')", "language": "python"}
        )
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
            mocker, wait_result={"StatusCode": 0}, logs_side_effect=[b"hi\n", b""]
        )
        resp = client.post(
            _EXECUTE_URL, json={"code": "console.log('hi')", "language": "javascript"}
        )
        assert resp.status_code == 200
        assert resp.json()["language"] == "javascript"

    def test_language_is_lowercased(self, mocker):
        _override_auth()
        _mock_docker(mocker, wait_result={"StatusCode": 0}, logs_side_effect=[b"", b""])
        resp = client.post(
            _EXECUTE_URL, json={"code": "print(1)", "language": "Python"}
        )
        assert resp.status_code == 200
        assert resp.json()["language"] == "python"

    def test_timed_out_response(self, mocker):
        _override_auth()
        mock_container = MagicMock()
        mock_container.wait.side_effect = requests.exceptions.ReadTimeout()
        mock_client = MagicMock()
        mock_client.containers.run.return_value = mock_container
        mocker.patch("app.services.rce.docker._get_client", return_value=mock_client)

        resp = client.post(
            _EXECUTE_URL,
            json={"code": "import time; time.sleep(100)", "language": "python"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["timed_out"] is True
        assert body["exit_code"] == -1


# ── /run-code/run-simple controller ───────────────────────────────────────────


class TestRunSimpleEndpoint:
    _BLOCK_ID = str(uuid4())

    def _payload(self, **overrides):
        return {
            "code": "print(1)",
            "language": "python",
            "block_id": self._BLOCK_ID,
            **overrides,
        }

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
        _mock_docker(
            mocker, run_raises=docker.errors.DockerException("daemon unavailable")
        )
        resp = client.post(_RUN_SIMPLE_URL, json=self._payload())
        assert resp.status_code == 500

    def test_missing_placeholder_returns_500(self, mocker):
        _override_auth()
        _mock_build_block_service(test_code="assert True")  # no --user-code--
        _mock_docker(mocker, wait_result={"StatusCode": 0}, logs_side_effect=[b"", b""])
        resp = client.post(_RUN_SIMPLE_URL, json=self._payload())
        assert resp.status_code == 500

    def test_successful_execution_returns_200(self, mocker):
        _override_auth()
        _mock_build_block_service()
        _mock_docker(
            mocker, wait_result={"StatusCode": 0}, logs_side_effect=[b"hello\n", b""]
        )
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

        resp = client.post(
            _RUN_SIMPLE_URL, json=self._payload(code="import time; time.sleep(100)")
        )
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
        mock_client.containers.run.side_effect = docker.errors.DockerException(
            "no daemon"
        )
        mocker.patch("app.services.rce.docker._get_client", return_value=mock_client)

        with pytest.raises(docker.errors.DockerException):
            rce_docker.run_code("x=1", "python")

    def test_semaphore_released_after_docker_error(self, mocker):
        mock_client = MagicMock()
        mock_client.containers.run.side_effect = docker.errors.DockerException(
            "no daemon"
        )
        mocker.patch("app.services.rce.docker._get_client", return_value=mock_client)
        mock_release = mocker.patch.object(rce_docker._semaphore, "release")

        with pytest.raises(docker.errors.DockerException):
            rce_docker.run_code("x=1", "python")

        mock_release.assert_called_once()

    def test_nonzero_exit_code_is_preserved(self, mocker):
        _mock_docker(
            mocker,
            wait_result={"StatusCode": 1},
            logs_side_effect=[b"", b"NameError\n"],
        )

        result = rce_docker.run_code("raise ValueError()", "python")

        assert result["exit_code"] == 1


class TestTestCodeSyntaxFailure:
    def test_message_includes_block_id_and_test_code(self):
        from uuid import UUID
        from app.exception.dsl import TestCodeSyntaxFailure

        block_id = UUID("12345678-1234-5678-1234-567812345678")
        test_code = "assert output == expected"
        exc = TestCodeSyntaxFailure(block_id, test_code)

        assert str(block_id) in str(exc)
        assert test_code in str(exc)
        assert "--user-code--" in str(exc)

    def test_stores_block_id_and_test_code_as_attributes(self):
        from uuid import UUID
        from app.exception.dsl import TestCodeSyntaxFailure

        block_id = UUID("12345678-1234-5678-1234-567812345678")
        test_code = "assert output == expected"
        exc = TestCodeSyntaxFailure(block_id, test_code)

        assert exc.block_id == block_id
        assert exc.test_code == test_code


# ── events ────────────────────────────────────────────────────────────────────


class TestRCEEvents:
    from app.services.rce.events import StdoutLine, StderrLine, ExitEvent, ErrorEvent

    def test_stdout_line_fields(self):
        from app.services.rce.events import StdoutLine

        e = StdoutLine(exec_id="abc", line="hello\n")
        assert e.exec_id == "abc"
        assert e.line == "hello\n"
        assert e.event_type == "stdout"

    def test_stderr_line_fields(self):
        from app.services.rce.events import StderrLine

        e = StderrLine(exec_id="abc", line="err\n")
        assert e.exec_id == "abc"
        assert e.line == "err\n"
        assert e.event_type == "stderr"

    def test_exit_event_fields(self):
        from app.services.rce.events import ExitEvent

        e = ExitEvent(exec_id="abc", exit_code=0, timed_out=False, duration_ms=42)
        assert e.exec_id == "abc"
        assert e.exit_code == 0
        assert e.timed_out is False
        assert e.duration_ms == 42
        assert e.event_type == "exit"

    def test_error_event_fields(self):
        from app.services.rce.events import ErrorEvent

        e = ErrorEvent(exec_id="abc", message="daemon down")
        assert e.exec_id == "abc"
        assert e.message == "daemon down"
        assert e.event_type == "error"

    def test_stdout_line_to_dict(self):
        from app.services.rce.events import StdoutLine
        import json

        e = StdoutLine(exec_id="abc", line="hello\n")
        d = e.to_dict()
        assert d == {"exec_id": "abc", "line": "hello\n", "event_type": "stdout"}
        json.dumps(d)  # must not raise

    def test_stderr_line_to_dict(self):
        from app.services.rce.events import StderrLine
        import json

        e = StderrLine(exec_id="abc", line="err\n")
        d = e.to_dict()
        assert d == {"exec_id": "abc", "line": "err\n", "event_type": "stderr"}
        json.dumps(d)

    def test_exit_event_to_dict(self):
        from app.services.rce.events import ExitEvent
        import json

        e = ExitEvent(exec_id="abc", exit_code=1, timed_out=True, duration_ms=9999)
        d = e.to_dict()
        assert d == {
            "exec_id": "abc",
            "exit_code": 1,
            "timed_out": True,
            "duration_ms": 9999,
            "event_type": "exit",
        }
        json.dumps(d)

    def test_error_event_to_dict(self):
        from app.services.rce.events import ErrorEvent
        import json

        e = ErrorEvent(exec_id="abc", message="daemon down")
        d = e.to_dict()
        assert d == {"exec_id": "abc", "message": "daemon down", "event_type": "error"}
        json.dumps(d)

    def test_exit_event_nonzero_exit_code(self):
        from app.services.rce.events import ExitEvent

        e = ExitEvent(exec_id="xyz", exit_code=-1, timed_out=True, duration_ms=10000)
        assert e.exit_code == -1
        assert e.timed_out is True

    def test_event_type_can_be_overridden(self):
        from app.services.rce.events import StdoutLine

        e = StdoutLine(exec_id="abc", line="x", event_type="custom")
        assert e.event_type == "custom"


# ── stream_code ───────────────────────────────────────────────────────────────


def _mock_stream_docker(mocker, chunks: list[bytes], *, run_raises=None):
    mock_container = MagicMock()
    mock_client = MagicMock()
    if run_raises:
        mock_client.containers.run.side_effect = run_raises
    else:
        mock_container.logs.return_value = iter(chunks)
        mock_client.containers.run.return_value = mock_container
    mocker.patch("app.services.rce.docker._get_client", return_value=mock_client)
    return mock_container, mock_client


class TestStreamCode:
    async def _collect(self, gen):
        lines = []
        async for line in gen:
            lines.append(line)
        return lines

    async def test_yields_complete_lines_from_single_chunks(self, mocker):
        _mock_stream_docker(mocker, [b"hello\n", b"world\n"])
        lines = await self._collect(rce_docker.stream_code("print('hi')", "python"))
        assert lines == [b"hello\n", b"world\n"]

    async def test_line_buffer_joins_split_chunks(self, mocker):
        _mock_stream_docker(mocker, [b"hel", b"lo\n", b"wor", b"ld\n"])
        lines = await self._collect(rce_docker.stream_code("print('hi')", "python"))
        assert lines == [b"hello\n", b"world\n"]

    async def test_multiple_newlines_in_one_chunk(self, mocker):
        _mock_stream_docker(mocker, [b"line1\nline2\nline3\n"])
        lines = await self._collect(rce_docker.stream_code("x=1", "python"))
        assert lines == [b"line1\n", b"line2\n", b"line3\n"]

    async def test_trailing_bytes_without_newline_are_yielded(self, mocker):
        _mock_stream_docker(mocker, [b"no newline"])
        lines = await self._collect(rce_docker.stream_code("x=1", "python"))
        assert lines == [b"no newline"]

    async def test_empty_output_yields_nothing(self, mocker):
        _mock_stream_docker(mocker, [])
        lines = await self._collect(rce_docker.stream_code("x=1", "python"))
        assert lines == []

    async def test_capacity_exceeded_raises_value_error(self, mocker):
        mocker.patch.object(rce_docker._semaphore, "acquire", return_value=False)
        with pytest.raises(ValueError, match="Too many concurrent"):
            await self._collect(rce_docker.stream_code("x=1", "python"))

    async def test_semaphore_released_after_stream(self, mocker):
        _mock_stream_docker(mocker, [b"ok\n"])
        mock_release = mocker.patch.object(rce_docker._semaphore, "release")
        await self._collect(rce_docker.stream_code("x=1", "python"))
        mock_release.assert_called_once()

    async def test_container_cleaned_up_after_stream(self, mocker):
        mock_container, _ = _mock_stream_docker(mocker, [b"ok\n"])
        await self._collect(rce_docker.stream_code("x=1", "python"))
        mock_container.stop.assert_called_once_with(timeout=0)
        mock_container.remove.assert_called_once()

    async def test_uses_unbuffered_cmd(self, mocker):
        _, mock_client = _mock_stream_docker(mocker, [])
        await self._collect(rce_docker.stream_code("x=1", "python"))
        _, kwargs = mock_client.containers.run.call_args
        cmd = kwargs["command"]
        assert "-u" in cmd[2]

    async def test_javascript_uses_line_buffer_flag(self, mocker):
        _, mock_client = _mock_stream_docker(mocker, [])
        await self._collect(rce_docker.stream_code("console.log(1)", "javascript"))
        _, kwargs = mock_client.containers.run.call_args
        cmd = kwargs["command"]
        assert "--line-buffer" in cmd[2]


# ── /rce/execute/stream controller ───────────────────────────────────────────


def _mock_rce_stream(mocker, chunks: list[bytes]):
    async def _fake_stream(code, language):
        for chunk in chunks:
            yield chunk

    mocker.patch("app.services.rce.stream_code", new=_fake_stream)


class TestExecuteStreamEndpoint:
    def test_unauthenticated_returns_401(self):
        resp = client.post(
            _EXECUTE_STREAM_URL, json={"code": "print(1)", "language": "python"}
        )
        assert resp.status_code == 401

    def test_unsupported_language_returns_400(self):
        _override_auth()
        resp = client.post(
            _EXECUTE_STREAM_URL, json={"code": "print(1)", "language": "brainfuck"}
        )
        assert resp.status_code == 400
        assert "brainfuck" in resp.json()["detail"]

    def test_successful_stream_returns_sse_content_type(self, mocker):
        _override_auth()
        _mock_rce_stream(mocker, [b"hello\n"])
        resp = client.post(
            _EXECUTE_STREAM_URL, json={"code": "print('hello')", "language": "python"}
        )
        assert resp.status_code == 200
        assert "text/event-stream" in resp.headers["content-type"]

    def test_each_line_is_sse_data_frame(self, mocker):
        _override_auth()
        _mock_rce_stream(mocker, [b"hello\n", b"world\n"])
        resp = client.post(
            _EXECUTE_STREAM_URL, json={"code": "x=1", "language": "python"}
        )
        frames = [line for line in resp.text.splitlines() if line.startswith("data:")]
        assert len(frames) == 2
        for frame in frames:
            assert frame.startswith("data: ")

    def test_sse_frame_is_valid_json(self, mocker):
        _override_auth()
        _mock_rce_stream(mocker, [b"hello\n"])
        resp = client.post(
            _EXECUTE_STREAM_URL, json={"code": "x=1", "language": "python"}
        )
        frame = next(
            line for line in resp.text.splitlines() if line.startswith("data:")
        )
        payload = json.loads(frame[len("data: ") :])
        assert payload["event_type"] == "stdout"
        assert "exec_id" in payload
        assert payload["line"] == "hello\n"

    def test_capacity_exceeded_emits_error_event(self, mocker):
        _override_auth()

        async def _capacity_exceeded(code, language):
            raise ValueError("Too many concurrent executions. Try again later.")
            yield  # make it an async generator

        mocker.patch("app.services.rce.stream_code", new=_capacity_exceeded)
        resp = client.post(
            _EXECUTE_STREAM_URL, json={"code": "x=1", "language": "python"}
        )
        assert resp.status_code == 200
        frame = next(
            line for line in resp.text.splitlines() if line.startswith("data:")
        )
        payload = json.loads(frame[len("data: ") :])
        assert payload["event_type"] == "error"
        assert "Too many" in payload["message"]

    def test_language_is_lowercased(self, mocker):
        _override_auth()
        _mock_rce_stream(mocker, [])
        resp = client.post(
            _EXECUTE_STREAM_URL, json={"code": "x=1", "language": "Python"}
        )
        assert resp.status_code == 200

    def test_all_events_share_same_exec_id(self, mocker):
        _override_auth()
        _mock_rce_stream(mocker, [b"line1\n", b"line2\n"])
        resp = client.post(
            _EXECUTE_STREAM_URL, json={"code": "x=1", "language": "python"}
        )
        frames = [line for line in resp.text.splitlines() if line.startswith("data:")]
        exec_ids = {json.loads(f[len("data: ") :])["exec_id"] for f in frames}
        assert len(exec_ids) == 1
