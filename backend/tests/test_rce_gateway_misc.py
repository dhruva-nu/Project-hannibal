"""Unit tests for the small RCE gateway helpers.

Covers the SSE relay framing/error-mapping, the test-code splicer, the DI
getter, the wire contracts, and the transport error classes.
"""

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.dependencies.rce import get_rce_client
from app.exception.dsl.errors import TestCodeSyntaxFailure
from app.schemas.build_block import BuildBlockResponse
from app.services.rce_gateway.contracts import (
    CONTRACT_VERSION,
    EventV1,
    JobV1,
    ResultBody,
    ResultError,
    ResultV1,
)
from app.services.rce_gateway.errors import (
    RceSaturated,
    RceServiceError,
    RceTimeout,
    RceUnavailable,
)
from app.services.rce_gateway.sse_relay import stream_sse
from app.services.rce_gateway.test_code import add_test_code


def _frames(text_frames: list[str]) -> list[dict]:
    return [json.loads(frame[len("data: ") :].strip()) for frame in text_frames]


class _FakeStreamClient:
    def __init__(self, events=None, raises=None):
        self._events = events or []
        self._raises = raises

    def stream(self, code, language):
        events = self._events
        raises = self._raises

        async def gen():
            if raises is not None:
                raise raises
            for event in events:
                yield event

        return gen()


class TestStreamSse:
    async def test_frames_each_event(self):
        client = _FakeStreamClient(
            events=[
                {"event_type": "stdout", "line": "hi\n"},
                {"event_type": "dependency_error", "package": "leftpad"},
            ]
        )
        frames = [frame async for frame in stream_sse(client, "code", "python")]
        assert all(
            frame.startswith("data: ") and frame.endswith("\n\n") for frame in frames
        )
        events = _frames(frames)
        assert events[0]["line"] == "hi\n"
        assert events[1]["package"] == "leftpad"

    async def test_transport_error_becomes_single_error_frame(self):
        client = _FakeStreamClient(raises=RceUnavailable("no broker"))
        frames = [frame async for frame in stream_sse(client, "code", "python")]
        events = _frames(frames)
        assert len(events) == 1
        assert events[0]["event_type"] == "error"
        assert events[0]["message"] == "no broker"

    async def test_unexpected_error_becomes_generic_error_frame(self):
        client = _FakeStreamClient(raises=ValueError("weird"))
        frames = [frame async for frame in stream_sse(client, "code", "python")]
        events = _frames(frames)
        assert len(events) == 1
        assert events[0]["event_type"] == "error"
        assert events[0]["message"] == "Execution service error."


class TestAddTestCode:
    async def test_splices_user_code_at_placeholder(self):
        block = BuildBlockResponse(
            id=uuid4(),
            instructions="",
            input="",
            output="",
            test_code="setup\n--user-code--\nteardown",
            code_template="",
            type="simple_run",
            tests=[],
        )
        service = MagicMock()
        service.get_block = AsyncMock(return_value=block)

        combined = await add_test_code("MINE", block.id, service)

        assert combined == "setup\nMINE\nteardown"
        service.get_block.assert_awaited_once_with(block.id)

    async def test_missing_placeholder_raises(self):
        block = BuildBlockResponse(
            id=uuid4(),
            instructions="",
            input="",
            output="",
            test_code="no placeholder",
            code_template="",
            type="simple_run",
            tests=[],
        )
        service = MagicMock()
        service.get_block = AsyncMock(return_value=block)

        with pytest.raises(TestCodeSyntaxFailure) as exc:
            await add_test_code("MINE", block.id, service)
        assert exc.value.block_id == block.id


def test_get_rce_client_reads_app_state():
    sentinel = object()
    request = SimpleNamespace(
        app=SimpleNamespace(state=SimpleNamespace(rce_client=sentinel))
    )
    assert get_rce_client(request) is sentinel


class TestContracts:
    def test_models_default_version(self):
        job = JobV1(job_id="1", mode="sync", language="python", code="x")
        result = ResultV1(job_id="1", ok=True)
        event = EventV1(job_id="1")
        assert job.v == CONTRACT_VERSION == 1
        assert result.v == 1
        assert event.v == 1
        assert event.event == {}

    def test_result_round_trip(self):
        original = ResultV1(
            job_id="1",
            ok=True,
            result=ResultBody(
                exec_id="e1",
                exit_code=0,
                stdout="out",
                stderr="",
                timed_out=False,
                duration_ms=3,
            ),
        )
        restored = ResultV1.model_validate_json(original.model_dump_json())
        assert restored.result.exec_id == "e1"
        assert restored.result.dependency_error is None

    def test_result_error_round_trip(self):
        original = ResultV1(
            job_id="1",
            ok=False,
            error=ResultError(code="saturated", message="busy"),
        )
        restored = ResultV1.model_validate_json(original.model_dump_json())
        assert restored.error.code == "saturated"


class TestErrors:
    @pytest.mark.parametrize(
        "exc_cls",
        [RceSaturated, RceTimeout, RceUnavailable, RceServiceError],
    )
    def test_each_error_is_raisable(self, exc_cls):
        with pytest.raises(exc_cls) as exc:
            raise exc_cls("boom")
        assert str(exc.value) == "boom"
