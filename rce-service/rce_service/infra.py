"""Per-run emulator networking for infra lessons (Phase 0b, issue #133).

A lesson that declares ``infra`` gets its own two-network topology, built fresh
for the run and destroyed with it::

    student container ──[ cannae-sbx-<run> : internal ]── cannae container
                                                                │
    rce-service (harness) ─[ cannae-ctl-<run> : internal ]──────┘
                                                        static IP, :9900

The split is the entire security property, and it rests on two facts:

* the emulator binds its control plane to its **harness** address only
  (``--control-bind``), so ``:9900`` is not listening on any interface the
  student container can route to — a student cannot seed, reset, or read the
  graded state of their own run;
* both networks are ``internal``, so the only thing student code can reach is
  the emulator's data ports. No internet, no host, no other run.

Lessons without infra never come near this module: they keep
``network_mode="none"``, byte for byte.
"""

import asyncio
import ipaddress
import itertools
import logging
import re
import threading
import time
import uuid
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import docker
import requests

from .config import CONTROL_PORT, INFRA_EMULATORS, INFRA_LIMITS
from .docker import _cleanup_container, _get_client
from .exceptions import InfraUnavailable
from .settings import settings

logger = logging.getLogger(__name__)

# Marks every object this module creates, so an operator can sweep leftovers
# from a hard-killed worker with a single `docker network prune --filter`.
LABELS = {"com.hannibal.cannae": "run"}

# The harness networks are carved out of one private pool, one /29 per run: five
# usable addresses is more than the gateway + emulator ever need, and a small
# block keeps thousands of concurrent runs addressable.
HARNESS_POOL = ipaddress.ip_network("10.99.0.0/16")
HARNESS_BLOCK_PREFIX = 29
_BLOCK_SIZE = 2 ** (32 - HARNESS_BLOCK_PREFIX)
_BLOCKS_IN_POOL = HARNESS_POOL.num_addresses // _BLOCK_SIZE

# A block can be taken by another run, or by an unrelated network on the same
# daemon. Walking a few candidates costs nothing and avoids a spurious failure.
_SUBNET_ATTEMPTS = 32

_block_cursor = itertools.count()
_cursor_lock = threading.Lock()

# Docker records the container's own id in its bind-mounted /etc/resolv.conf
# entry. Reading it there is stable across cgroup v1 and v2, unlike /proc/self/cgroup.
_SELF_ID_PATTERN = re.compile(r"/docker/containers/([0-9a-f]{64})/")

_SUBNET_CONFLICT_MARKERS = ("overlaps", "already exists", "no available")


@dataclass(frozen=True)
class EmulatorSession:
    """One run's live emulator: its container, its two networks, its addresses."""

    run_id: str
    container: Any
    sandbox_network: Any
    harness_network: Any
    #: Harness-only base URL of the control plane. Never given to the student.
    control_url: str
    #: Connection strings handed to the student container as ordinary env vars.
    student_env: dict[str, str]


def resolve_infra(infra: Sequence[str]) -> tuple[list[str], dict[str, str]]:
    """The network aliases and student env vars for the declared emulators.

    Raises :class:`InfraUnavailable` for an unknown emulator, or for two
    emulators claiming the same hostname — the second would silently shadow the
    first and hand the student a connection string pointing somewhere else.
    """
    aliases: list[str] = []
    student_env: dict[str, str] = {}
    for name in infra:
        spec = INFRA_EMULATORS.get(name)
        if spec is None:
            raise InfraUnavailable(
                f"unknown infra emulator {name!r}; "
                f"known: {', '.join(sorted(INFRA_EMULATORS))}"
            )
        if spec["alias"] in aliases:
            raise InfraUnavailable(
                f"infra {list(infra)} declares two emulators on hostname "
                f"{spec['alias']!r}"
            )
        aliases.append(spec["alias"])
        student_env.update(spec["env"])
    return aliases, student_env


def _harness_subnet(index: int) -> ipaddress.IPv4Network:
    """The index-th /29 of :data:`HARNESS_POOL`, wrapping at the end of the pool."""
    base = int(HARNESS_POOL.network_address) + (index % _BLOCKS_IN_POOL) * _BLOCK_SIZE
    return ipaddress.ip_network((base, HARNESS_BLOCK_PREFIX))


def _is_subnet_conflict(error: docker.errors.APIError) -> bool:
    message = str(error).lower()
    return any(marker in message for marker in _SUBNET_CONFLICT_MARKERS)


def _create_harness_network(client, name: str) -> tuple[Any, str]:
    """Create the harness network on a free block; return it and the emulator IP.

    The subnet is chosen here rather than left to Docker because the emulator's
    address has to be known *before* the container starts — it is passed to the
    binary as ``--control-bind``.
    """
    for _ in range(_SUBNET_ATTEMPTS):
        with _cursor_lock:
            subnet = _harness_subnet(next(_block_cursor))
        gateway, emulator_ip = list(subnet.hosts())[:2]
        pool = docker.types.IPAMPool(subnet=str(subnet), gateway=str(gateway))
        try:
            network = client.networks.create(
                name,
                driver="bridge",
                internal=True,
                ipam=docker.types.IPAMConfig(pool_configs=[pool]),
                labels=LABELS,
            )
        except docker.errors.APIError as error:
            if not _is_subnet_conflict(error):
                raise
            logger.debug("harness subnet %s taken, trying the next", subnet)
            continue
        return network, str(emulator_ip)
    raise InfraUnavailable(
        f"no free /{HARNESS_BLOCK_PREFIX} left in {HARNESS_POOL} after "
        f"{_SUBNET_ATTEMPTS} attempts"
    )


def _self_container_id() -> str | None:
    """This worker's own container id, or ``None`` when it runs on a bare host.

    In production the worker is itself a container, so it has to join the
    harness network to reach the control plane. On a developer machine or a CI
    runner it talks to the daemon from the host, where the bridge is already
    routable and there is nothing to attach.
    """
    try:
        mountinfo = Path("/proc/self/mountinfo").read_text()
    except OSError:
        return None
    match = _SELF_ID_PATTERN.search(mountinfo)
    return match.group(1) if match else None


def _attach_worker(network) -> None:
    worker = _self_container_id()
    if worker is None:
        return
    network.connect(worker)


def _require_emulator_image(client) -> None:
    try:
        client.images.get(settings.cannae_image)
    except docker.errors.ImageNotFound as error:
        raise InfraUnavailable(
            f"emulator image {settings.cannae_image!r} is missing; build it with "
            f"`docker build -t {settings.cannae_image} cannae-service/`"
        ) from error


def _start_emulator(client, run_id: str, infra: Sequence[str], network: str, ip: str):
    """The emulator container: as locked down as the student sandbox, minus the
    parts it does not need.

    Same posture — no capabilities, no privilege escalation, ``nobody``,
    read-only rootfs, bounded memory and pids. No tmpfs: the image is ``FROM
    scratch`` and the binary writes nothing, so there is no reason to give it a
    writable mount. ``--control-bind`` pins the control plane to the harness
    address; binding ``0.0.0.0`` here would expose ``:9900`` on the sandbox
    network the moment it is attached.
    """
    endpoint = client.api.create_endpoint_config(ipv4_address=ip)
    return client.containers.run(
        image=settings.cannae_image,
        command=[
            "--infra",
            ",".join(infra),
            "--control-bind",
            f"{ip}:{CONTROL_PORT}",
        ],
        name=f"cannae-{run_id}",
        detach=True,
        network=network,
        networking_config={network: endpoint},
        mem_limit=INFRA_LIMITS["memory"],
        memswap_limit=INFRA_LIMITS["memory"],
        pids_limit=INFRA_LIMITS["pid"],
        cap_drop=["ALL"],
        security_opt=["no-new-privileges"],
        user="65534:65534",
        read_only=True,
        labels=LABELS,
    )


def _wait_until_ready(control_url: str, run_id: str) -> None:
    """Block until the control plane answers.

    Without this the student container could race the emulator's first bind and
    get a connection refused that has nothing to do with the lesson.
    """
    deadline = time.monotonic() + INFRA_LIMITS["ready_timeout"]
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            requests.get(f"{control_url}/log", timeout=1).raise_for_status()
            return
        except requests.exceptions.RequestException as error:
            last_error = error
            time.sleep(0.05)
    raise InfraUnavailable(
        f"emulator control plane never answered | run_id={run_id} "
        f"url={control_url}: {last_error}"
    )


def _disconnect_everything(network) -> None:
    """Detach every remaining endpoint so the network can actually be removed.

    The worker attaches itself to the harness network and Docker refuses to
    remove a network with endpoints left on it.
    """
    network.reload()
    for container_id in network.attrs.get("Containers", {}):
        try:
            network.disconnect(container_id, force=True)
        except Exception:
            logger.debug(
                "network disconnect failed | network=%s container=%s",
                network.name,
                container_id,
                exc_info=True,
            )


def _tear_down(container, networks: Sequence[Any], run_id: str) -> None:
    """Remove whatever exists, never raise. Also the failed-startup unwind path."""
    if container is not None:
        _cleanup_container(container, f"cannae-{run_id}")
    for network in networks:
        if network is None:
            continue
        try:
            _disconnect_everything(network)
            network.remove()
        except Exception:
            logger.debug(
                "network remove failed | run_id=%s network=%s",
                run_id,
                network.name,
                exc_info=True,
            )


def start_session(infra: Sequence[str]) -> EmulatorSession:
    """Bring up one run's emulator and its two networks. Blocking.

    Any failure part-way leaves nothing behind: the unwind removes whatever was
    created before re-raising.
    """
    aliases, student_env = resolve_infra(infra)
    client = _get_client()
    _require_emulator_image(client)

    run_id = uuid.uuid4().hex[:12]
    sandbox = harness = container = None
    try:
        sandbox = client.networks.create(
            f"cannae-sbx-{run_id}", driver="bridge", internal=True, labels=LABELS
        )
        harness, emulator_ip = _create_harness_network(client, f"cannae-ctl-{run_id}")
        _attach_worker(harness)
        container = _start_emulator(client, run_id, infra, harness.name, emulator_ip)
        sandbox.connect(container, aliases=aliases)
        control_url = f"http://{emulator_ip}:{CONTROL_PORT}"
        _wait_until_ready(control_url, run_id)
    except Exception:
        _tear_down(container, [sandbox, harness], run_id)
        raise

    logger.info(
        "infra session started | run_id=%s infra=%s aliases=%s",
        run_id,
        list(infra),
        aliases,
    )
    return EmulatorSession(
        run_id=run_id,
        container=container,
        sandbox_network=sandbox,
        harness_network=harness,
        control_url=control_url,
        student_env=student_env,
    )


def stop_session(session: EmulatorSession) -> None:
    """Destroy the run's emulator and both of its networks."""
    _tear_down(
        session.container,
        [session.sandbox_network, session.harness_network],
        session.run_id,
    )
    logger.info("infra session stopped | run_id=%s", session.run_id)


@asynccontextmanager
async def infra_session(
    infra: Sequence[str],
) -> AsyncIterator[EmulatorSession | None]:
    """The run's emulator for the duration of the block, or ``None`` for a
    lesson that declares no infra.

    Startup and teardown are Docker round-trips, so both go to a thread rather
    than stalling the consumer's event loop.
    """
    session = await asyncio.to_thread(start_session, infra) if infra else None
    try:
        yield session
    finally:
        if session is not None:
            await asyncio.to_thread(stop_session, session)
