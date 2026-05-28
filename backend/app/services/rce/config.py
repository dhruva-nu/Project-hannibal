OUTPUT_CAP_BYTES = 256 * 1024  # 256 KB per stream

SUPPORTED_LANGS = ["python", "javascript"]

RUNTIME: dict[str, dict] = {
    "python": {
        "image": "python:3.11-alpine",
        "cmd": lambda f: ["python3", f],
        "ext": "py",
    },
    "javascript": {
        "image": "node:20-alpine",
        "cmd": lambda f: ["node", f],
        "ext": "js",
    },
}

LIMITS = {
    "time": 10,
    "memory": 128 * 1024**2,  # 128 MB
    "pid": 10,
}
