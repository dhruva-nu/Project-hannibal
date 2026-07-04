"""The global content-addressable package cache (SUB2 of #103).

One named Docker volume per language — the pnpm-store equivalent — shared by
every execution. The mount posture is the security contract:

- the **installer** phase (network on, SUB3) mounts it **read-write** and is
  the only writer;
- the **run** phase (untrusted student code) mounts it **read-only**, so a
  compromised run can consume packages but never poison the store.

Volumes are created lazily on first use and survive container churn; the
backend talks to the host Docker daemon, so the names here are global on the
host, not compose-project-scoped.
"""

import logging

import docker

from .provider import DepsProvider

logger = logging.getLogger(__name__)


def ensure_cache_volume(client: docker.DockerClient, provider: DepsProvider) -> None:
    """Create the language's cache volume if the host doesn't have it yet."""
    try:
        client.volumes.get(provider.cache_volume)
    except docker.errors.NotFound:
        logger.info("creating package cache volume %s", provider.cache_volume)
        client.volumes.create(provider.cache_volume)


def install_phase_mounts(provider: DepsProvider) -> dict[str, dict[str, str]]:
    """Volume spec for the installer container: the cache, and only it, writable."""
    return {provider.cache_volume: {"bind": provider.cache_path, "mode": "rw"}}


def run_phase_mounts(provider: DepsProvider) -> dict[str, dict[str, str]]:
    """Volume spec for the run container: the cache is never writable here."""
    return {provider.cache_volume: {"bind": provider.cache_path, "mode": "ro"}}


def prewarm_packages(provider: DepsProvider) -> list[str]:
    """What to seed the cache with: the whole curated allowlist.

    The allowlist doubles as the pre-warm list by design — every package a
    student may import should already be hot. The installer (SUB3) consumes
    this to populate the volume ahead of first use.
    """
    return sorted(provider.allowlist)
