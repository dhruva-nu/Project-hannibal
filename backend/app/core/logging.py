import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path

from app.core.config import settings

_FORMAT = "%(asctime)s | %(levelname)s | %(name)s | %(message)s"


def configure_logging() -> None:
    level = getattr(logging, settings.log_level, logging.INFO)
    handlers: list[logging.Handler] = [logging.StreamHandler()]

    if settings.log_enabled:
        log_path = Path(settings.log_file)
        log_path.parent.mkdir(parents=True, exist_ok=True)
        handlers.append(
            RotatingFileHandler(log_path, maxBytes=10_000_000, backupCount=5)
        )

    logging.basicConfig(level=level, format=_FORMAT, handlers=handlers, force=True)
