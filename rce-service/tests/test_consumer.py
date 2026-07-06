"""Tests for the RabbitMQ message handler wiring.

``make_handler`` returns an ``on_message`` coroutine; a sync job replies on the
job's ``reply_to`` queue, a stream job publishes events keyed ``exec.<job_id>``.
AMQP and handlers are mocked — no broker.
"""

from unittest.mock import AsyncMock, MagicMock

from rce_service.consumer import declare_topology, make_handler
from rce_service.contracts import EventV1, JobV1, ResultBody, ResultV1


class _ACM:
    async def __aenter__(self):
        return None

    async def __aexit__(self, *args):
        return False


def _message(job: JobV1, *, reply_to: str | None) -> MagicMock:
    message = MagicMock()
    message.body = job.model_dump_json().encode()
    message.reply_to = reply_to
    message.correlation_id = job.job_id
    message.process.return_value = _ACM()
    return message


class TestSyncJob:
    async def test_publishes_reply_on_the_reply_queue(self, mocker):
        job = JobV1(job_id="j1", mode="sync", language="python", code="print(1)")
        canned = ResultV1(
            job_id="j1",
            ok=True,
            result=ResultBody(
                exec_id="e",
                exit_code=0,
                stdout="",
                stderr="",
                timed_out=False,
                duration_ms=1,
            ),
        )
        mocker.patch("rce_service.consumer.handle_sync", AsyncMock(return_value=canned))

        channel = MagicMock()
        channel.default_exchange.publish = AsyncMock()
        events_exchange = MagicMock()

        on_message = make_handler(channel, events_exchange)
        await on_message(_message(job, reply_to="reply.q"))

        channel.default_exchange.publish.assert_awaited_once()
        published_message = channel.default_exchange.publish.call_args.args[0]
        assert channel.default_exchange.publish.call_args.kwargs["routing_key"] == (
            "reply.q"
        )
        assert published_message.correlation_id == "j1"


class TestStreamJob:
    async def test_publishes_events_keyed_by_exec_prefix(self, mocker):
        job = JobV1(job_id="j1", mode="stream", language="python", code="print(1)")

        async def fake_stream(_job):
            yield EventV1(job_id="j1", event={"event_type": "stdout", "line": "hi\n"})

        mocker.patch("rce_service.consumer.handle_stream", new=fake_stream)

        channel = MagicMock()
        events_exchange = MagicMock()
        events_exchange.publish = AsyncMock()

        on_message = make_handler(channel, events_exchange)
        await on_message(_message(job, reply_to=None))

        events_exchange.publish.assert_awaited_once()
        routing_key = events_exchange.publish.call_args.kwargs["routing_key"]
        assert routing_key.startswith("exec.")


class TestSyncJobWithoutReplyTo:
    async def test_missing_reply_to_publishes_nothing(self, mocker):
        job = JobV1(job_id="j1", mode="sync", language="python", code="print(1)")
        canned = ResultV1(
            job_id="j1",
            ok=True,
            result=ResultBody(
                exec_id="e",
                exit_code=0,
                stdout="",
                stderr="",
                timed_out=False,
                duration_ms=1,
            ),
        )
        mocker.patch("rce_service.consumer.handle_sync", AsyncMock(return_value=canned))

        channel = MagicMock()
        channel.default_exchange.publish = AsyncMock()

        on_message = make_handler(channel, MagicMock())
        await on_message(_message(job, reply_to=None))

        channel.default_exchange.publish.assert_not_awaited()


class TestDeclareTopology:
    async def test_sets_prefetch_and_returns_queue_and_exchange(self):
        channel = MagicMock()
        channel.set_qos = AsyncMock()
        queue = object()
        exchange = object()
        channel.declare_queue = AsyncMock(return_value=queue)
        channel.declare_exchange = AsyncMock(return_value=exchange)

        result = await declare_topology(channel)

        channel.set_qos.assert_awaited_once()
        assert result == (queue, exchange)
