"""Tests for the job handlers: sync → ResultV1, stream → EventV1 generator.

Dependencies and Docker are mocked. ``run_code`` is invoked through
``run_in_executor``, so a plain callable/MagicMock is enough.
"""

from unittest.mock import AsyncMock, MagicMock

from rce_service.contracts import JobV1
from rce_service.exceptions import DependencyInstallError, UnpermittedDependency
from rce_service.handlers import handle_stream, handle_sync

_RUN_RESULT = {
    "exec_id": "e1",
    "stdout": "hi\n",
    "stderr": "",
    "exit_code": 0,
    "timed_out": False,
    "duration_ms": 12,
}


def _sync_job() -> JobV1:
    return JobV1(job_id="j1", mode="sync", language="python", code="print(1)")


def _stream_job() -> JobV1:
    return JobV1(job_id="j1", mode="stream", language="python", code="print(1)")


# ── handle_sync ────────────────────────────────────────────────────────────────


class TestHandleSync:
    async def test_success_returns_populated_result(self, mocker):
        mocker.patch("rce_service.handlers.prepare_dependencies", AsyncMock())
        mocker.patch(
            "rce_service.handlers.run_code", MagicMock(return_value=_RUN_RESULT)
        )

        result = await handle_sync(_sync_job())

        assert result.ok is True
        assert result.result is not None
        assert result.result.stdout == "hi\n"
        assert result.result.exit_code == 0
        assert result.result.dependency_error is None
        assert result.error is None

    async def test_unpermitted_dependency_is_a_not_allowed_result(self, mocker):
        mocker.patch(
            "rce_service.handlers.prepare_dependencies",
            AsyncMock(side_effect=UnpermittedDependency("leftpad", "python")),
        )

        result = await handle_sync(_sync_job())

        assert result.ok is True
        assert result.result.dependency_error["kind"] == "not_allowed"
        assert result.result.dependency_error["package"] == "leftpad"

    async def test_install_failure_is_an_install_failed_result(self, mocker):
        mocker.patch(
            "rce_service.handlers.prepare_dependencies",
            AsyncMock(side_effect=DependencyInstallError(["numpy"], "python", "boom")),
        )

        result = await handle_sync(_sync_job())

        assert result.ok is True
        assert result.result.dependency_error["kind"] == "install_failed"

    async def test_saturation_is_a_transport_error(self, mocker):
        mocker.patch("rce_service.handlers.prepare_dependencies", AsyncMock())
        mocker.patch(
            "rce_service.handlers.run_code",
            MagicMock(side_effect=ValueError("Too many concurrent executions.")),
        )

        result = await handle_sync(_sync_job())

        assert result.ok is False
        assert result.error.code == "saturated"

    async def test_unexpected_fault_is_an_internal_error(self, mocker):
        mocker.patch("rce_service.handlers.prepare_dependencies", AsyncMock())
        mocker.patch(
            "rce_service.handlers.run_code",
            MagicMock(side_effect=Exception("kaboom")),
        )

        result = await handle_sync(_sync_job())

        assert result.ok is False
        assert result.error.code == "internal"


# ── handle_stream ────────────────────────────────────────────────────────────


async def _collect(gen):
    return [event async for event in gen]


class TestHandleStream:
    async def test_happy_path_yields_stdout_then_exit(self, mocker):
        mocker.patch("rce_service.handlers.prepare_dependencies", AsyncMock())

        async def fake_stream(code, lang):
            yield b"hello\n"

        mocker.patch("rce_service.handlers.stream_code", new=fake_stream)

        events = await _collect(handle_stream(_stream_job()))

        assert events[0].event["event_type"] == "stdout"
        assert events[0].event["line"] == "hello\n"
        assert events[-1].event["event_type"] == "exit"

    async def test_dependency_error_yields_single_event(self, mocker):
        mocker.patch(
            "rce_service.handlers.prepare_dependencies",
            AsyncMock(side_effect=UnpermittedDependency("leftpad", "python")),
        )

        events = await _collect(handle_stream(_stream_job()))

        assert len(events) == 1
        assert events[0].event["event_type"] == "dependency_error"
        assert events[0].event["package"] == "leftpad"

    async def test_saturation_yields_a_single_error_event(self, mocker):
        mocker.patch(
            "rce_service.handlers.prepare_dependencies",
            AsyncMock(side_effect=ValueError("Too many concurrent executions.")),
        )

        events = await _collect(handle_stream(_stream_job()))

        assert len(events) == 1
        assert events[0].event["event_type"] == "error"
        assert "Too many" in events[0].event["message"]

    async def test_unexpected_fault_yields_a_generic_error_event(self, mocker):
        mocker.patch(
            "rce_service.handlers.prepare_dependencies",
            AsyncMock(side_effect=Exception("kaboom")),
        )

        events = await _collect(handle_stream(_stream_job()))

        assert len(events) == 1
        assert events[0].event["event_type"] == "error"
        assert events[0].event["message"] == "Execution service error."
