"""RabbitMQ wiring: declare the topology and turn each job into a reply/events.

Topology (see hannibal-vault/features/code-execution.md):
- ``rce.jobs`` — durable work queue, bounded (``x-max-length`` + reject-publish)
  so a saturated system nacks the publisher into an HTTP 429 instead of growing
  an unbounded backlog. Prefetch matches the run-phase semaphore.
- ``rce.events`` — durable topic exchange; stream events are published with
  routing key ``exec.<job_id>`` for the backend's per-job relay queue.

Sync jobs are acked only after their reply is published (``message.process``
exits at the end of the block), so a worker that dies mid-run redelivers the
job — safe, because execution is stateless.
"""

import logging

import aio_pika
from aio_pika.abc import (
    AbstractChannel,
    AbstractExchange,
    AbstractIncomingMessage,
    AbstractQueue,
)

from .contracts import JobV1
from .handlers import handle_stream, handle_sync
from .settings import EVENTS_EXCHANGE, JOBS_MAX_LENGTH, JOBS_QUEUE, settings

logger = logging.getLogger(__name__)


async def declare_topology(
    channel: AbstractChannel,
) -> tuple[AbstractQueue, AbstractExchange]:
    await channel.set_qos(prefetch_count=settings.prefetch)
    jobs_queue = await channel.declare_queue(
        JOBS_QUEUE,
        durable=True,
        arguments={
            "x-max-length": JOBS_MAX_LENGTH,
            "x-overflow": "reject-publish",
        },
    )
    events_exchange = await channel.declare_exchange(
        EVENTS_EXCHANGE, aio_pika.ExchangeType.TOPIC, durable=True
    )
    return jobs_queue, events_exchange


async def _publish_reply(
    channel: AbstractChannel, message: AbstractIncomingMessage, body: bytes
) -> None:
    if not message.reply_to:
        logger.warning(
            "sync job without reply_to | correlation_id=%s", message.correlation_id
        )
        return
    await channel.default_exchange.publish(
        aio_pika.Message(
            body=body,
            correlation_id=message.correlation_id,
            content_type="application/json",
        ),
        routing_key=message.reply_to,
    )


async def _run_stream(events_exchange: AbstractExchange, job: JobV1) -> None:
    async for event in handle_stream(job):
        await events_exchange.publish(
            aio_pika.Message(
                body=event.model_dump_json().encode(),
                content_type="application/json",
            ),
            routing_key=f"exec.{job.job_id}",
        )


def make_handler(channel: AbstractChannel, events_exchange: AbstractExchange):
    async def on_message(message: AbstractIncomingMessage) -> None:
        # process(): ack on clean exit, nack (no requeue) on exception. The
        # reply/events are published inside the block, so the ack lands after.
        async with message.process(requeue=False, ignore_processed=True):
            job = JobV1.model_validate_json(message.body)
            logger.info("job received | job_id=%s mode=%s", job.job_id, job.mode)
            if job.mode == "stream":
                await _run_stream(events_exchange, job)
            else:
                result = await handle_sync(job)
                await _publish_reply(
                    channel, message, result.model_dump_json().encode()
                )

    return on_message
