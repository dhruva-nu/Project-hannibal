"""Tests for the job handlers: sync → ResultV1, stream → EventV1 generator.

Dependencies and Docker are mocked. ``run_code`` is invoked through
``run_in_executor``, so a plain callable/MagicMock is enough.
"""

from unittest.mock import AsyncMock, MagicMock

from rce_service.contracts import JobV1
from rce_service.exceptions import (
    DependencyInstallError,
    InfraUnavailable,
    UnpermittedDependency,
)
from rce_service.handlers import handle_stream, handle_sync

_RUN_RESULT = {
    "exec_id": "e1",
    "stdout": "hi\n",
    "stderr": "",
    "exit_code": 0,
    "timed_out": False,
    "duration_ms": 12,
}


def _sync_job(**overrides) -> JobV1:
    return JobV1(
        job_id="j1", mode="sync", language="python", code="print(1)", **overrides
    )


def _stream_job(**overrides) -> JobV1:
    return JobV1(
        job_id="j1", mode="stream", language="python", code="print(1)", **overrides
    )


def _mock_session(mocker, session):
    """Stand in for the real Docker session lifecycle around a handler call."""
    mocker.patch("rce_service.infra.start_session", MagicMock(return_value=session))
    stop = mocker.patch("rce_service.infra.stop_session", MagicMock())
    return stop


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


# ── infra sessions ───────────────────────────────────────────────────────────


class TestInfraSessionLifecycle:
    async def test_no_infra_runs_without_a_session(self, mocker):
        mocker.patch("rce_service.handlers.prepare_dependencies", AsyncMock())
        run = mocker.patch(
            "rce_service.handlers.run_code", MagicMock(return_value=_RUN_RESULT)
        )
        start = mocker.patch("rce_service.infra.start_session", MagicMock())

        await handle_sync(_sync_job())

        start.assert_not_called()
        assert run.call_args.args[2] is None

    async def test_declared_infra_is_handed_to_the_sandbox_and_torn_down(self, mocker):
        mocker.patch("rce_service.handlers.prepare_dependencies", AsyncMock())
        run = mocker.patch(
            "rce_service.handlers.run_code", MagicMock(return_value=_RUN_RESULT)
        )
        session = MagicMock()
        stop = _mock_session(mocker, session)

        result = await handle_sync(_sync_job(infra=["echo"]))

        assert result.ok is True
        assert run.call_args.args[2] is session
        stop.assert_called_once_with(session)

    async def test_the_session_is_torn_down_even_when_the_run_blows_up(self, mocker):
        mocker.patch("rce_service.handlers.prepare_dependencies", AsyncMock())
        mocker.patch(
            "rce_service.handlers.run_code", MagicMock(side_effect=Exception("kaboom"))
        )
        session = MagicMock()
        stop = _mock_session(mocker, session)

        result = await handle_sync(_sync_job(infra=["echo"]))

        assert result.error.code == "internal"
        stop.assert_called_once_with(session)

    async def test_unavailable_infra_is_an_internal_error_not_a_saturation(
        self, mocker
    ):
        # It must not land in the ValueError arm: telling a student to retry
        # later would hide a broken emulator image behind a busy message.
        mocker.patch("rce_service.handlers.prepare_dependencies", AsyncMock())
        mocker.patch(
            "rce_service.infra.start_session",
            MagicMock(side_effect=InfraUnavailable("no image")),
        )

        result = await handle_sync(_sync_job(infra=["echo"]))

        assert result.ok is False
        assert result.error.code == "internal"


# ── handle_stream ────────────────────────────────────────────────────────────


async def _collect(gen):
    return [event async for event in gen]


class TestHandleStream:
    async def test_happy_path_yields_stdout_then_exit(self, mocker):
        mocker.patch("rce_service.handlers.prepare_dependencies", AsyncMock())

        async def fake_stream(code, lang, session):
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

    async def test_streaming_with_infra_passes_and_releases_the_session(self, mocker):
        mocker.patch("rce_service.handlers.prepare_dependencies", AsyncMock())
        session = MagicMock()
        stop = _mock_session(mocker, session)
        seen = []

        async def fake_stream(code, lang, run_session):
            seen.append(run_session)
            yield b"hello\n"

        mocker.patch("rce_service.handlers.stream_code", new=fake_stream)

        events = await _collect(handle_stream(_stream_job(infra=["echo"])))

        assert seen == [session]
        assert events[0].event["line"] == "hello\n"
        stop.assert_called_once_with(session)
