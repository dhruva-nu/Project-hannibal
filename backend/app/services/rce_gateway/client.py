"""RPC-over-RabbitMQ client for the RCE microservice.

The backend keeps synchronous HTTP semantics by publishing a job and awaiting a
correlated reply:

- **sync** (``execute``): publish to ``rce.jobs`` with ``reply_to`` pointing at
  this process's exclusive reply queue; a background consumer resolves the
  matching future. Bounded by ``rpc_timeout`` → :class:`RceTimeout`.
- **stream** (``stream``): bind a per-job queue to the ``rce.events`` topic
  exchange *before* publishing (so no early lines are lost), then relay events
  until a terminal one. An idle gap beyond ``stream_idle_timeout`` yields a
  synthetic error event so the browser never hangs.

A full queue (``x-overflow: reject-publish`` + publisher confirms) nacks the
publish → :class:`RceSaturated`. A dead broker → :class:`RceUnavailable`.
"""

import asyncio
import logging
import uuid
from collections.abc import AsyncGenerator
from datetime import timedelta

import aio_pika
from aio_pika.abc import AbstractIncomingMessage

from .contracts import EventV1, JobV1, ResultV1
from .errors import RceSaturated, RceServiceError, RceTimeout, RceUnavailable

logger = logging.getLogger(__name__)

JOBS_QUEUE = "rce.jobs"
EVENTS_EXCHANGE = "rce.events"
_JOB_TTL_SECONDS = 30  # a job nobody consumes in time dies instead of running late
_TERMINAL_EVENTS = {"exit", "error", "dependency_error"}
_STREAM_QUEUE_ARGS = {
    "x-expires": 120_000,  # GC the queue if the SSE client vanishes
    "x-max-length": 4096,  # bound a slow consumer; output is already capped at 256KB
    "x-overflow": "drop-head",
}


class RceQueueClient:
    def __init__(
        self, url: str, rpc_timeout: float, stream_idle_timeout: float
    ) -> None:
        self._url = url
        self._rpc_timeout = rpc_timeout
        self._stream_idle_timeout = stream_idle_timeout
        self._connection: aio_pika.abc.AbstractRobustConnection | None = None
        self._channel: aio_pika.abc.AbstractChannel | None = None
        self._reply_queue: aio_pika.abc.AbstractQueue | None = None
        self._events_exchange: aio_pika.abc.AbstractExchange | None = None
        self._pending: dict[str, asyncio.Future] = {}

    async def connect(self) -> None:
        self._connection = await aio_pika.connect_robust(self._url)
        self._connection.reconnect_callbacks.add(self._on_reconnect)
        self._channel = await self._connection.channel(publisher_confirms=True)
        self._reply_queue = await self._channel.declare_queue(
            exclusive=True, auto_delete=True
        )
        await self._reply_queue.consume(self._on_reply, no_ack=True)
        self._events_exchange = await self._channel.declare_exchange(
            EVENTS_EXCHANGE, aio_pika.ExchangeType.TOPIC, durable=True
        )

    async def close(self) -> None:
        self._fail_pending(RceUnavailable("RCE client shutting down"))
        if self._connection is not None:
            await self._connection.close()

    def _on_reconnect(self, _connection, _connector=None) -> None:
        # A reconnect re-declares the reply queue under a new consumer, so any
        # in-flight replies are lost — fail their futures fast, never leak.
        self._fail_pending(RceUnavailable("RCE broker connection was reset"))

    def _fail_pending(self, exc: Exception) -> None:
        for future in self._pending.values():
            if not future.done():
                future.set_exception(exc)
        self._pending.clear()

    async def _on_reply(self, message: AbstractIncomingMessage) -> None:
        future = self._pending.get(message.correlation_id)
        if future is not None and not future.done():
            future.set_result(bytes(message.body))

    async def _publish(self, job: JobV1, reply_to: str | None) -> None:
        message = aio_pika.Message(
            body=job.model_dump_json().encode(),
            content_type="application/json",
            correlation_id=job.job_id,
            reply_to=reply_to,
            delivery_mode=aio_pika.DeliveryMode.NOT_PERSISTENT,
            expiration=timedelta(seconds=_JOB_TTL_SECONDS),
        )
        try:
            await self._channel.default_exchange.publish(
                message, routing_key=JOBS_QUEUE, mandatory=True
            )
        except aio_pika.exceptions.DeliveryError as exc:
            logger.warning("job rejected by broker | job_id=%s", job.job_id)
            raise RceSaturated(
                "Too many concurrent executions. Try again later."
            ) from exc
        except (aio_pika.exceptions.AMQPError, ConnectionError) as exc:
            raise RceUnavailable("RCE service is unavailable.") from exc

    async def execute(self, code: str, language: str) -> dict:
        """Run to completion and return the result body (as the HTTP layer needs)."""
        job = JobV1(job_id=str(uuid.uuid4()), mode="sync", language=language, code=code)
        future: asyncio.Future = asyncio.get_running_loop().create_future()
        self._pending[job.job_id] = future
        try:
            await self._publish(job, reply_to=self._reply_queue.name)
            raw = await asyncio.wait_for(future, timeout=self._rpc_timeout)
        except TimeoutError as exc:
            raise RceTimeout("RCE service timed out.") from exc
        finally:
            self._pending.pop(job.job_id, None)
        return self._unwrap(ResultV1.model_validate_json(raw))

    @staticmethod
    def _unwrap(result: ResultV1) -> dict:
        if result.ok and result.result is not None:
            return result.result.model_dump()
        if result.error is not None and result.error.code == "saturated":
            raise RceSaturated(result.error.message)
        message = result.error.message if result.error else "Execution service error."
        raise RceServiceError(message)

    async def stream(self, code: str, language: str) -> AsyncGenerator[dict]:
        """Yield sandbox events (as dicts) until a terminal one.

        The terminal ``exit`` event is consumed silently (the frontend never saw
        it before the split); ``error`` / ``dependency_error`` are yielded then
        end the stream.
        """
        job = JobV1(
            job_id=str(uuid.uuid4()), mode="stream", language=language, code=code
        )
        queue = await self._channel.declare_queue(
            f"rce.events.{job.job_id}",
            exclusive=True,
            auto_delete=True,
            arguments=_STREAM_QUEUE_ARGS,
        )
        await queue.bind(self._events_exchange, routing_key=f"exec.{job.job_id}")
        await self._publish(job, reply_to=None)

        try:
            async with queue.iterator(timeout=self._stream_idle_timeout) as events:
                async for message in events:
                    async with message.process():
                        event = EventV1.model_validate_json(message.body).event
                    event_type = event.get("event_type")
                    if event_type == "exit":
                        break
                    yield event
                    if event_type in _TERMINAL_EVENTS:
                        break
        except TimeoutError:
            yield {
                "event_type": "error",
                "exec_id": job.job_id,
                "message": "RCE service timed out.",
            }
        finally:
            await queue.delete(if_unused=False, if_empty=False)
