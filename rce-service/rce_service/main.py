"""RCE worker entrypoint: connect to RabbitMQ and consume jobs forever.

uv run python -m rce_service.main
"""

import asyncio
import logging
import signal

import aio_pika

from .consumer import declare_topology, make_handler
from .prewarm import prewarm_all
from .settings import JOBS_QUEUE, settings

logger = logging.getLogger(__name__)


async def _prewarm() -> None:
    # install_packages() is blocking (Docker SDK), so keep it off the loop.
    await asyncio.get_running_loop().run_in_executor(None, prewarm_all)


async def run() -> None:
    logging.basicConfig(level=settings.log_level)
    connection = await aio_pika.connect_robust(settings.rabbitmq_url)
    channel = await connection.channel()
    jobs_queue, events_exchange = await declare_topology(channel)

    if settings.prewarm_on_start:
        # Fire-and-forget: don't block consuming on minutes of downloads.
        asyncio.create_task(_prewarm())

    await jobs_queue.consume(make_handler(channel, events_exchange))
    logger.info("consuming %s", JOBS_QUEUE)

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop.set)

    await stop.wait()
    logger.info("shutting down")
    await connection.close()


if __name__ == "__main__":  # pragma: no cover
    asyncio.run(run())
