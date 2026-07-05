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

# The installer runs unprivileged (see installer.py). A fresh named volume
# mounts owned by root, so the installer can't write to it until its mount
# point is handed to this uid.
INSTALLER_UID = 65534


def ensure_cache_volume(client: docker.DockerClient, provider: DepsProvider) -> None:
    """Create the language's cache volume if the host doesn't have it yet."""
    try:
        client.volumes.get(provider.cache_volume)
    except docker.errors.NotFound:
        logger.info("creating package cache volume %s", provider.cache_volume)
        client.volumes.create(provider.cache_volume)


def ensure_cache_writable(
    client: docker.DockerClient, provider: DepsProvider, image: str
) -> None:
    """Give the unprivileged installer ownership of the cache mount point.

    Docker creates a fresh named volume owned by root, but the installer runs
    as ``INSTALLER_UID`` (non-root) — so ``pip --target`` / ``npm --prefix``
    can't write the volume root without this. A short root-only ``chown``
    (``CAP_CHOWN`` only, no network, read-only rootfs) fixes the mount point;
    idempotent, so it also heals volumes created before this step existed.
    """
    client.containers.run(
        image=image,
        command=["chown", f"{INSTALLER_UID}:{INSTALLER_UID}", provider.cache_path],
        user="0:0",
        network_mode="none",
        cap_drop=["ALL"],
        cap_add=["CHOWN"],
        read_only=True,
        remove=True,
        volumes=install_phase_mounts(provider),
    )


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
