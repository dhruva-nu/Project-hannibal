"""Unit tests for RceQueueClient with aio_pika fully mocked.

The client owns the RPC-over-RabbitMQ plumbing: an exclusive reply queue for
``execute`` and a per-job bound queue for ``stream``. Every broker call is an
awaitable, so the aio_pika module is replaced with a mock whose async methods
are ``AsyncMock`` and whose exception classes are real so ``except`` clauses
match.
"""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.rce_gateway.client import (
    EVENTS_EXCHANGE,
    JOBS_QUEUE,
    RceQueueClient,
)
from app.services.rce_gateway.contracts import (
    EventV1,
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


def _mock_aio(mocker):
    module = mocker.patch("app.services.rce_gateway.client.aio_pika")
    module.exceptions.DeliveryError = type("DeliveryError", (Exception,), {})
    module.exceptions.AMQPError = type("AMQPError", (Exception,), {})
    return module


def _client(rpc_timeout: float = 1.0, stream_idle_timeout: float = 1.0):
    return RceQueueClient(
        url="amqp://guest@localhost/",
        rpc_timeout=rpc_timeout,
        stream_idle_timeout=stream_idle_timeout,
    )


class _AsyncCM:
    def __init__(self, value=None):
        self._value = value

    async def __aenter__(self):
        return self._value

    async def __aexit__(self, *_):
        return False


class _FakeMessage:
    def __init__(self, event: dict, job_id: str = "j1"):
        self.body = EventV1(job_id=job_id, event=event).model_dump_json().encode()

    def process(self):
        return _AsyncCM()


class _FakeIterator:
    def __init__(self, messages, raise_timeout: bool = False):
        self._messages = messages
        self._raise_timeout = raise_timeout

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return False

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        if self._raise_timeout:
            raise TimeoutError()
        for message in self._messages:
            yield message


class TestConnect:
    async def test_opens_connection_channel_reply_queue_and_exchange(self, mocker):
        module = _mock_aio(mocker)
        channel = MagicMock()
        reply_queue = MagicMock()
        reply_queue.name = "reply.q"
        reply_queue.consume = AsyncMock()
        channel.declare_queue = AsyncMock(return_value=reply_queue)
        exchange = MagicMock()
        channel.declare_exchange = AsyncMock(return_value=exchange)
        connection = MagicMock()
        connection.channel = AsyncMock(return_value=channel)
        module.connect_robust = AsyncMock(return_value=connection)

        client = _client()
        await client.connect()

        module.connect_robust.assert_awaited_once_with("amqp://guest@localhost/")
        connection.reconnect_callbacks.add.assert_called_once_with(client._on_reconnect)
        connection.channel.assert_awaited_once_with(publisher_confirms=True)
        channel.declare_queue.assert_awaited_once_with(exclusive=True, auto_delete=True)
        reply_queue.consume.assert_awaited_once_with(client._on_reply, no_ack=True)
        channel.declare_exchange.assert_awaited_once_with(
            EVENTS_EXCHANGE, module.ExchangeType.TOPIC, durable=True
        )
        assert client._reply_queue is reply_queue
        assert client._events_exchange is exchange


class TestUnwrap:
    def test_ok_result_returns_dict(self):
        result = ResultV1(
            job_id="1",
            ok=True,
            result=ResultBody(
                exec_id="e1",
                exit_code=0,
                stdout="out",
                stderr="",
                timed_out=False,
                duration_ms=2,
            ),
        )
        assert RceQueueClient._unwrap(result)["exec_id"] == "e1"

    def test_saturated_error_raises_saturated(self):
        result = ResultV1(
            job_id="1",
            ok=False,
            error=ResultError(code="saturated", message="busy"),
        )
        with pytest.raises(RceSaturated, match="busy"):
            RceQueueClient._unwrap(result)

    def test_internal_error_raises_service_error(self):
        result = ResultV1(
            job_id="1",
            ok=False,
            error=ResultError(code="internal", message="kaboom"),
        )
        with pytest.raises(RceServiceError, match="kaboom"):
            RceQueueClient._unwrap(result)

    def test_no_error_body_raises_generic_service_error(self):
        result = ResultV1(job_id="1", ok=False)
        with pytest.raises(RceServiceError, match="Execution service error."):
            RceQueueClient._unwrap(result)


class TestExecute:
    async def test_happy_path_returns_unwrapped_result(self, mocker):
        _mock_aio(mocker)
        client = _client()
        client._reply_queue = SimpleNamespace(name="reply.q")

        async def resolve(job, reply_to):
            assert reply_to == "reply.q"
            job_id = next(iter(client._pending))
            raw = (
                ResultV1(
                    job_id=job_id,
                    ok=True,
                    result=ResultBody(
                        exec_id="e1",
                        exit_code=0,
                        stdout="hi\n",
                        stderr="",
                        timed_out=False,
                        duration_ms=4,
                    ),
                )
                .model_dump_json()
                .encode()
            )
            await client._on_reply(SimpleNamespace(correlation_id=job_id, body=raw))

        client._publish = AsyncMock(side_effect=resolve)

        result = await client.execute("print(1)", "python")

        assert result["exec_id"] == "e1"
        assert result["stdout"] == "hi\n"
        assert client._pending == {}

    async def test_timeout_raises_and_cleans_up_pending(self, mocker):
        _mock_aio(mocker)
        client = _client(rpc_timeout=0.01)
        client._reply_queue = SimpleNamespace(name="reply.q")
        client._publish = AsyncMock()

        with pytest.raises(RceTimeout):
            await client.execute("print(1)", "python")

        assert client._pending == {}


class TestPublish:
    def _job(self):
        from app.services.rce_gateway.contracts import JobV1

        return JobV1(job_id="job-1", mode="sync", language="python", code="x")

    async def test_success_publishes_to_default_exchange(self, mocker):
        module = _mock_aio(mocker)
        client = _client()
        channel = MagicMock()
        channel.default_exchange.publish = AsyncMock()
        client._channel = channel

        await client._publish(self._job(), reply_to="reply.q")

        publish = channel.default_exchange.publish
        publish.assert_awaited_once()
        assert publish.call_args.kwargs["routing_key"] == JOBS_QUEUE
        assert publish.call_args.kwargs["mandatory"] is True
        module.Message.assert_called_once()

    async def test_delivery_error_raises_saturated(self, mocker):
        module = _mock_aio(mocker)
        client = _client()
        channel = MagicMock()
        channel.default_exchange.publish = AsyncMock(
            side_effect=module.exceptions.DeliveryError("nacked")
        )
        client._channel = channel

        with pytest.raises(RceSaturated):
            await client._publish(self._job(), reply_to="reply.q")

    async def test_amqp_error_raises_unavailable(self, mocker):
        module = _mock_aio(mocker)
        client = _client()
        channel = MagicMock()
        channel.default_exchange.publish = AsyncMock(
            side_effect=module.exceptions.AMQPError("dead")
        )
        client._channel = channel

        with pytest.raises(RceUnavailable):
            await client._publish(self._job(), reply_to="reply.q")

    async def test_connection_error_raises_unavailable(self, mocker):
        _mock_aio(mocker)
        client = _client()
        channel = MagicMock()
        channel.default_exchange.publish = AsyncMock(
            side_effect=ConnectionError("refused")
        )
        client._channel = channel

        with pytest.raises(RceUnavailable):
            await client._publish(self._job(), reply_to="reply.q")


class TestOnReply:
    async def test_unknown_correlation_id_is_ignored(self):
        client = _client()
        await client._on_reply(SimpleNamespace(correlation_id="nope", body=b"{}"))

    async def test_already_done_future_is_left_untouched(self):
        client = _client()
        future = asyncio.get_running_loop().create_future()
        future.set_result(b"first")
        client._pending["c1"] = future
        await client._on_reply(SimpleNamespace(correlation_id="c1", body=b"second"))
        assert future.result() == b"first"


class TestFailPendingAndReconnect:
    async def test_reconnect_fails_pending_futures(self):
        client = _client()
        loop = asyncio.get_running_loop()
        pending = loop.create_future()
        already_done = loop.create_future()
        already_done.set_result(b"done")
        client._pending = {"a": pending, "b": already_done}

        client._on_reconnect(MagicMock())

        assert client._pending == {}
        with pytest.raises(RceUnavailable):
            pending.result()
        assert already_done.result() == b"done"


class TestClose:
    async def test_close_without_connection_only_fails_pending(self):
        client = _client()
        loop = asyncio.get_running_loop()
        pending = loop.create_future()
        client._pending = {"a": pending}

        await client.close()

        assert client._pending == {}
        with pytest.raises(RceUnavailable):
            pending.result()

    async def test_close_with_connection_closes_it(self):
        client = _client()
        connection = MagicMock()
        connection.close = AsyncMock()
        client._connection = connection

        await client.close()

        connection.close.assert_awaited_once()


class TestStream:
    def _setup(self, client, iterator):
        queue = MagicMock()
        queue.bind = AsyncMock()
        queue.delete = AsyncMock()
        queue.iterator = MagicMock(return_value=iterator)
        channel = MagicMock()
        channel.declare_queue = AsyncMock(return_value=queue)
        client._channel = channel
        client._events_exchange = MagicMock()
        client._publish = AsyncMock()
        return queue

    async def test_stdout_yielded_and_exit_ends_silently(self, mocker):
        _mock_aio(mocker)
        client = _client()
        iterator = _FakeIterator(
            [
                _FakeMessage({"event_type": "stdout", "line": "hi\n"}),
                _FakeMessage({"event_type": "exit", "exit_code": 0}),
            ]
        )
        queue = self._setup(client, iterator)

        events = [event async for event in client.stream("print(1)", "python")]

        assert events == [{"event_type": "stdout", "line": "hi\n"}]
        client._publish.assert_awaited_once()
        queue.bind.assert_awaited_once()
        queue.delete.assert_awaited_once_with(if_unused=False, if_empty=False)

    async def test_terminal_error_event_is_yielded_then_stream_ends(self, mocker):
        _mock_aio(mocker)
        client = _client()
        iterator = _FakeIterator(
            [
                _FakeMessage({"event_type": "stdout", "line": "a"}),
                _FakeMessage({"event_type": "error", "message": "boom"}),
                _FakeMessage({"event_type": "stdout", "line": "unreached"}),
            ]
        )
        queue = self._setup(client, iterator)

        events = [event async for event in client.stream("print(1)", "python")]

        assert events == [
            {"event_type": "stdout", "line": "a"},
            {"event_type": "error", "message": "boom"},
        ]
        queue.delete.assert_awaited_once()

    async def test_idle_timeout_yields_synthetic_error(self, mocker):
        _mock_aio(mocker)
        client = _client()
        iterator = _FakeIterator([], raise_timeout=True)
        queue = self._setup(client, iterator)

        events = [event async for event in client.stream("print(1)", "python")]

        assert len(events) == 1
        assert events[0]["event_type"] == "error"
        assert events[0]["message"] == "RCE service timed out."
        queue.delete.assert_awaited_once()
