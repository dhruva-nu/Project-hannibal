"""The sandboxed installer: the only writer of the package cache (SUB3 of #103).

This is the network-ON phase, so it is the most dangerous container this
service starts. The safety argument:

- it runs **the package manager only** — the command comes from the provider's
  ``install_cmd`` and the (re-checked) allowlist; student code never gets near
  this container;
- install scripts are disabled (``pip --only-binary=:all:``,
  ``npm --ignore-scripts``), because package hooks are arbitrary code execution;
- everything else is dropped: all capabilities, privilege escalation, root,
  writable rootfs (except the cache mount and a tmpfs) — and **no Docker
  socket**;
- it has its own timeout and concurrency cap, separate from the run semaphore.

On success it stamps ``<cache>/.installed/<package>`` markers — the cache
index the install queue (SUB4) reads. A failed install writes no markers, so
the cache is never poisoned by a partial install.
"""

import logging
import shlex
import threading
import time

import requests.exceptions

from .config import RUNTIME
from .deps.cache import (
    ensure_cache_volume,
    ensure_cache_writable,
    install_phase_mounts,
)
from .deps.provider import DepsProvider
from .docker import _cleanup_container, _get_client
from .exceptions import DependencyInstallError, UnpermittedDependency
from .result import _truncate

logger = logging.getLogger(__name__)

INSTALLED_MARKER_DIR = ".installed"

INSTALL_LIMITS = {
    "time": 120,  # package downloads are slow; still bounded
    "memory": 512 * 1024**2,
    "pid": 128,  # npm/pip fan out helper processes
    "concurrency": 2,
}

# Bounds network-on containers, independently of the run-phase semaphore (5).
_install_semaphore = threading.Semaphore(INSTALL_LIMITS["concurrency"])

# The package manager needs writable scratch space; everything lands on tmpfs.
_INSTALLER_ENV = {
    "HOME": "/tmp",  # nosec B108 — tmpfs inside the installer sandbox
    "TMPDIR": "/tmp",  # nosec B108
    "npm_config_cache": "/tmp/.npm",  # nosec B108
    "npm_config_update_notifier": "false",
}


def _installer_shell_command(provider: DepsProvider, packages: list[str]) -> str:
    """The install command plus success markers, as one shell line.

    Markers are written only if the install exits 0 — the ``&&`` is the
    cache-cleanliness guarantee.
    """
    install = shlex.join(provider.install_cmd(packages, provider.cache_path))
    marker_dir = f"{provider.cache_path}/{INSTALLED_MARKER_DIR}"
    markers = shlex.join(
        ["touch", *(f"{marker_dir}/{package}" for package in packages)]
    )
    return f"{install} && mkdir -p {shlex.quote(marker_dir)} && {markers}"


def _start_installer(provider: DepsProvider, packages: list[str]):
    """Network ON, cache RW — and nothing else: no caps, no root, no rootfs
    writes, no privilege escalation, and no Docker socket anywhere in sight."""
    client = _get_client()
    image = RUNTIME[provider.language]["image"]
    ensure_cache_volume(client, provider)
    ensure_cache_writable(client, provider, image)
    return client.containers.run(
        image=image,
        command=["sh", "-c", _installer_shell_command(provider, packages)],
        detach=True,
        mem_limit=INSTALL_LIMITS["memory"],
        memswap_limit=INSTALL_LIMITS["memory"],
        pids_limit=INSTALL_LIMITS["pid"],
        cap_drop=["ALL"],
        security_opt=["no-new-privileges"],
        user="65534:65534",
        read_only=True,
        tmpfs={"/tmp": "size=256m,mode=1777"},  # nosec B108 — sandboxed tmpfs
        volumes=install_phase_mounts(provider),
        environment=_INSTALLER_ENV,
    )


def install_packages(provider: DepsProvider, packages: list[str]) -> None:
    """Populate the cache with ``packages``. Blocking; raises on any failure."""
    if not packages:
        return

    for package in packages:
        if package not in provider.allowlist:  # defence in depth vs. resolve()
            raise UnpermittedDependency(package, provider.language)

    _install_semaphore.acquire()
    container = None
    start = time.time()
    logger.info(
        "install started | language=%s packages=%s", provider.language, packages
    )

    try:
        container = _start_installer(provider, packages)
        exit_code = container.wait(timeout=INSTALL_LIMITS["time"])["StatusCode"]
        if exit_code != 0:
            stderr = _truncate(container.logs(stdout=False, stderr=True))
            logger.warning(
                "install failed | language=%s packages=%s exit_code=%d",
                provider.language,
                packages,
                exit_code,
            )
            raise DependencyInstallError(
                packages, provider.language, stderr.strip() or f"exit code {exit_code}"
            )
        logger.info(
            "install finished | language=%s packages=%s duration_ms=%d",
            provider.language,
            packages,
            int((time.time() - start) * 1000),
        )
    except requests.exceptions.ReadTimeout:
        try:
            container.kill()
        except Exception:
            logger.debug("kill after install timeout failed", exc_info=True)
        raise DependencyInstallError(
            packages,
            provider.language,
            f"install exceeded the {INSTALL_LIMITS['time']}s time limit",
        )
    finally:
        _install_semaphore.release()
        if container is not None:
            _cleanup_container(container, f"install-{provider.language}")
