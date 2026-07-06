"""The install queue gating the cold path (SUB4 of #103).

The hot path costs nothing: a cached dependency set goes straight to the run
phase without touching the queue. On a miss, three guarantees coordinate the
network-on installers (SUB3):

- **in-flight dedupe** — thirty students importing ``numpy`` at once produce
  one install job; everyone else awaits the same future;
- **single writer per cache volume** — pip/npm mutate shared files inside the
  store, so a per-language lock ensures two installers never write the same
  volume concurrently;
- **failure leaves the cache clean** — markers are only written by a
  successful installer, and a failed job is forgotten so the next request
  simply retries.

Cache resolution is content-addressable in two layers: an in-process record of
what this backend has installed, backed by the ``.installed/<package>``
markers the installer stamps into the volume (mounted read-only into the
backend by docker-compose), which survive restarts and are shared across
replicas.
"""

import asyncio
import hashlib
import logging
from pathlib import Path

from .deps.provider import DepsProvider
from .installer import INSTALLED_MARKER_DIR, install_packages

logger = logging.getLogger(__name__)


def dep_set_hash(packages: list[str]) -> str:
    """A stable identity for a normalized dependency set.

    Order- and duplicate-insensitive, so ``["numpy", "pandas"]`` and
    ``["pandas", "numpy", "numpy"]`` are the same set — one hash, one cache
    entry, one install job.
    """
    canonical = "\n".join(sorted(set(packages)))
    return hashlib.sha256(canonical.encode()).hexdigest()


class InstallQueue:
    def __init__(self):
        self._inflight: dict[tuple[str, str], asyncio.Future] = {}
        self._known_installed: set[tuple[str, str]] = set()
        self._admission = asyncio.Lock()
        self._volume_writers: dict[str, asyncio.Lock] = {}

    def _is_cached(self, provider: DepsProvider, package: str) -> bool:
        key = (provider.language, package)
        if key in self._known_installed:
            return True
        marker = Path(provider.cache_path) / INSTALLED_MARKER_DIR / package
        if marker.exists():
            self._known_installed.add(key)
            return True
        return False

    async def ensure(self, provider: DepsProvider, packages: list[str]) -> None:
        """Block until every package is in the cache; the hit path is free.

        Raises whatever the failing install job raised (typically
        ``DependencyInstallError``) — the caller decides how to surface it.
        """
        missing = [p for p in packages if not self._is_cached(provider, p)]
        if not missing:
            return

        logger.info(
            "cache miss | language=%s missing=%s dep_set=%s",
            provider.language,
            missing,
            dep_set_hash(packages)[:12],
        )
        await asyncio.gather(*await self._admit(provider, missing))

    async def _admit(
        self, provider: DepsProvider, missing: list[str]
    ) -> list[asyncio.Future]:
        """One future per missing package, reusing in-flight jobs (the dedupe)."""
        async with self._admission:
            writer = self._volume_writers.setdefault(provider.language, asyncio.Lock())
            jobs = []
            for package in missing:
                if self._is_cached(provider, package):
                    continue  # its install job finished while we queued up
                key = (provider.language, package)
                future = self._inflight.get(key)
                if future is None:
                    future = asyncio.ensure_future(
                        self._install(provider, package, writer)
                    )
                    self._inflight[key] = future
                jobs.append(future)
            return jobs

    async def _install(
        self, provider: DepsProvider, package: str, writer: asyncio.Lock
    ) -> None:
        key = (provider.language, package)
        try:
            async with writer:  # exactly one writer per cache volume
                await asyncio.get_running_loop().run_in_executor(
                    None, install_packages, provider, [package]
                )
            self._known_installed.add(key)
        finally:
            # Success is remembered above; failure is forgotten entirely so a
            # later request retries instead of awaiting a dead future.
            async with self._admission:
                self._inflight.pop(key, None)


install_queue = InstallQueue()
