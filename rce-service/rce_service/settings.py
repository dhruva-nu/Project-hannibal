"""Runtime configuration for the RCE worker, read from the environment."""

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    rabbitmq_url: str = os.getenv("RABBITMQ_URL", "amqp://guest:guest@localhost:5672/")
    # Concurrent jobs a single worker pulls at once. Matches the run-phase
    # semaphore in docker.py (5) so the queue never admits more work than the
    # sandbox can run.
    prefetch: int = int(os.getenv("RCE_PREFETCH", "5"))
    prewarm_on_start: bool = os.getenv("PREWARM_ON_START", "false").lower() == "true"
    log_level: str = os.getenv("LOG_LEVEL", "INFO").upper()


# Queue / exchange names — the wire contract shared with the backend gateway.
JOBS_QUEUE = "rce.jobs"
JOBS_MAX_LENGTH = 20
EVENTS_EXCHANGE = "rce.events"

settings = Settings()
