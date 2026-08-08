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

# Sized so a lesson's emulators can share the sandbox with the student's process
# (#153). Measured under the real posture by ``emu-service/verify-sandbox.sh``,
# so move these with a measurement rather than a hunch.
LIMITS = {
    "time": 30,  # multi-service lessons are slower than a single script
    "memory": 192 * 1024**2,  # 192 MB: emulator state shares the cgroup
    "pid": 32,  # emu + a child measures 9 tasks; 10 left the student no room
}
