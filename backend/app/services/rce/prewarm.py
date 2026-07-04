"""Seed the package caches so allowlisted packages are hot before first use.

Run from the backend container (or any host with the Docker socket):

    uv run python -m app.services.rce.prewarm
"""

import logging

from .deps import DEPS_PROVIDERS
from .deps.cache import prewarm_packages
from .installer import install_packages

logger = logging.getLogger(__name__)


def prewarm_all() -> None:
    for provider in DEPS_PROVIDERS.values():
        packages = prewarm_packages(provider)
        logger.info("prewarming %s cache | packages=%s", provider.language, packages)
        install_packages(provider, packages)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    prewarm_all()
