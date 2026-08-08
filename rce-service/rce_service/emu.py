"""Everything rce-service knows about ``emu``, the infrastructure emulator (#153).

A lesson that declares emulators runs the same sandbox as every other execution,
with one difference: ``emu`` takes the command slot and the student's interpreter
becomes its child, so the emulators are listening on loopback before the child's
first ``connect()``. A request that declares nothing runs exactly as it did
before — no binary mounted, no wrapper, no environment change.

Three things this module settles, none of which the plan pinned down:

- **The binary arrives in a read-only named volume**, the same posture
  ``deps/cache.py`` gives the package caches. Population is a build-time job
  (``just publish-emu`` / ``docker compose up`` / CI), never something the worker
  does — rce-service cannot compile Go and must not learn how.
- **The config is written into the run container's tmpfs, not bind-mounted.**
  rce-service drives the *host* Docker daemon while living in its own container,
  so a path it writes is not a path the daemon can mount — which is exactly why
  the student's code already travels base64-encoded inside the command. The
  config rides the same way. It is safe in a student-writable tmpfs because
  ``emu`` reads it, arms the faults, and binds the ports *before* the child
  exists: by the time anything untrusted can touch the file, nothing reads it
  again.
- **``exec`` hands emu the container's PID 1.** Without it emu is a child of the
  ``sh -c`` wrapper, and every guarantee measured in ``verify-sandbox.sh``
  evaporates: a student sharing uid 65534 could ``kill -9`` the process injecting
  the faults that grade them, and orphaned grandchildren would reparent to a
  shell that never reaps.
"""

import base64
import json
import logging
from typing import Any

import docker

logger = logging.getLogger(__name__)

# Fixed (un-prefixed) name, for the same reason the package caches have one: the
# worker drives the host daemon directly, so sandbox containers reference the
# volume by a name that is global on the host, not compose-project-scoped.
BINARY_VOLUME = "emu-bin"
BINARY_DIR = "/emu"
BINARY = f"{BINARY_DIR}/emu"

# The tmpfs the run container already mounts. Written before emu starts, read
# once, and gone with the container.
CONFIG_PATH = "/tmp/emu-config.json"  # nosec B108 — sandboxed tmpfs

# emu dumps its op log as one JSON line under this key.
OPLOG_KEY = "emu_oplog"

# GOMAXPROCS caps the OS threads (and so the pid count and stack memory) an
# emulator no lesson saturates has any use for; GOMEMLIMIT stops Go's GC from
# letting the heap double before it collects, inside a cgroup shared with the
# student's own process.
ENV = {"GOMAXPROCS": "1", "GOMEMLIMIT": "48MiB"}


class EmuNotPublished(RuntimeError):
    """The emulator volume was never populated, so no lesson can run."""

    def __str__(self) -> str:
        return (
            f"the {BINARY_VOLUME} volume holds no emu binary — "
            "run `just publish-emu` (or `docker compose up emu-publisher`)"
        )


def ensure_published(client: docker.DockerClient) -> None:
    """Fail before the container starts if the binary was never published.

    Without this the run fails inside the sandbox as ``exec /emu/emu: no such
    file or directory``, which reaches the student as their own program's stderr.
    """
    try:
        client.volumes.get(BINARY_VOLUME)
    except docker.errors.NotFound as missing:
        raise EmuNotPublished() from missing


def mounts() -> dict[str, dict[str, str]]:
    """The binary, and only the binary, and never writable."""
    return {BINARY_VOLUME: {"bind": BINARY_DIR, "mode": "ro"}}


def encode_config(config: dict[str, Any]) -> str:
    """The lesson's ``config.json``, ready to be decoded into the tmpfs."""
    return base64.b64encode(json.dumps(config).encode()).decode()


def wrap(argv: list[str]) -> list[str]:
    """``<argv>`` → ``emu run --config <path> -- <argv>``.

    The argv emu sees is built here and nowhere else. It carries no
    ``--dev-control-socket`` and no ``--dev-control-bind``: student code shares
    emu's uid, so any control channel reachable inside the sandbox lets the code
    being graded disarm the faults grading it. The threat model is measured in
    ``emu-service/verify-sandbox.sh``; ``tests/test_rce_security_invariants.py``
    is what stops this line from quietly growing a flag.
    """
    return [BINARY, "run", "--config", CONFIG_PATH, "--", *argv]


def split_oplog(raw: bytes) -> tuple[bytes, list[dict[str, Any]] | None]:
    """Separate emu's op log from the student's own stdout.

    emu writes the log after the child has exited, so it is always the last line
    — and *only* the last line is considered, which is what stops a student
    printing a forged ``emu_oplog`` line and having it graded instead. Splitting
    happens before output truncation, so a chatty program cannot push the graded
    artifact past the 256 KB cap.

    A log the ring buffer truncated is self-describing: entries carry a logical
    ordinal, so one that does not start at ``n: 1`` lost its oldest entries.
    """
    stripped = raw.rstrip(b"\n")
    _, _, last_line = stripped.rpartition(b"\n")

    entries = _decode_oplog(last_line)
    if entries is None:
        logger.warning("an emu run produced no op log; emu may have died early")
        return raw, None
    return stripped[: len(stripped) - len(last_line)], entries


def is_oplog_line(line: bytes) -> bool:
    """Whether a streamed line is the op log rather than student output."""
    return _decode_oplog(line.rstrip(b"\n")) is not None


def _decode_oplog(line: bytes) -> list[dict[str, Any]] | None:
    try:
        dump = json.loads(line)
    except ValueError:
        return None
    if not isinstance(dump, dict) or OPLOG_KEY not in dump:
        return None
    return dump[OPLOG_KEY]
