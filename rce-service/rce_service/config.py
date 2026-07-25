from .deps import DEPS_PROVIDERS

OUTPUT_CAP_BYTES = 256 * 1024  # 256 KB per stream

SUPPORTED_LANGS = ["python", "javascript"]

RUNTIME: dict[str, dict] = {
    "python": {
        "image": "python:3.11-alpine",
        "cmd": lambda f: ["python3", f],
        "unbuffered_cmd": lambda f: [
            "python3",
            "-u",
            f,
        ],  # -u: disable stdout buffering so Docker logs stream each line immediately
        "ext": "py",
        "deps": DEPS_PROVIDERS["python"],
    },
    "javascript": {
        "image": "node:20-alpine",
        "cmd": lambda f: ["node", f],
        "unbuffered_cmd": lambda f: [
            "node",
            "--line-buffer",
            f,
        ],  # --line-buffer: flush stdout per line for real-time Docker log streaming
        "ext": "js",
        "deps": DEPS_PROVIDERS["javascript"],
    },
}

LIMITS = {
    "time": 10,
    "memory": 128 * 1024**2,  # 128 MB
    "pid": 10,
}

# ── Infra emulators (Phase 0b, issue #133) ────────────────────────────────────

# The control plane the harness talks to. Never bound on the sandbox network —
# see rce_service/infra.py for why that is the whole security property.
CONTROL_PORT = 9900

# What a lesson may declare in ``JobV1.infra``, and what the student sees for it.
# ``alias`` is the network alias the emulator answers to on the sandbox network,
# so the connection string is an ordinary hostname exactly like a real
# deployment. Only ``echo`` has a backing emulator today (Phase 0); the rest are
# the locked contract Phases 1-4 fill in (plans/infra-emulators.md §1).
INFRA_EMULATORS: dict[str, dict] = {
    "echo": {
        "alias": "echo",
        "env": {"ECHO_URL": "tcp://echo:7777"},
    },
    "postgres": {
        "alias": "db",
        "env": {"DATABASE_URL": "postgresql://student:student@db:5432/app"},
    },
    "redis": {
        "alias": "cache",
        "env": {"REDIS_URL": "redis://cache:6379"},
    },
    "mongo": {
        "alias": "db",
        "env": {"MONGO_URL": "mongodb://db:27017/app"},
    },
    "amqp": {
        "alias": "queue",
        "env": {"AMQP_URL": "amqp://guest:guest@queue:5672/"},
    },
}

INFRA_LIMITS = {
    "memory": 128 * 1024**2,  # 128 MB
    "pid": 64,  # tokio worker threads, not processes; generous but bounded
    "ready_timeout": 10,  # seconds to wait for the control plane to answer
}
