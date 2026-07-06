"""Frozen language metadata the backend needs without the sandbox.

When the RCE sandbox moved to its own service, the backend lost the
``DepsProvider`` objects (they pull in ``docker`` and ``tree-sitter``). But two
backend concerns still need a little language metadata: the RCE controllers
validate the requested language, and the editor's package-search feature needs
each language's standard-library set and import→distribution name map. Those
are pure data, duplicated here so the backend stays free of the sandbox's heavy
dependencies. Keep in sync with ``rce_service`` providers when the allowlists or
language set change.
"""

import sys

SUPPORTED_LANGS: list[str] = ["python", "javascript"]

# Node built-ins — importable with or without a "node:" prefix; never installed.
_NODE_BUILTINS: frozenset[str] = frozenset(
    {
        "assert", "async_hooks", "buffer", "child_process", "cluster",
        "console", "constants", "crypto", "dgram", "diagnostics_channel",
        "dns", "domain", "events", "fs", "http", "http2", "https", "inspector",
        "module", "net", "os", "path", "perf_hooks", "process", "punycode",
        "querystring", "readline", "repl", "stream", "string_decoder", "sys",
        "timers", "tls", "trace_events", "tty", "url", "util", "v8", "vm",
        "wasi", "worker_threads", "zlib",
    }
)  # fmt: skip

STDLIB: dict[str, frozenset[str]] = {
    "python": frozenset(sys.stdlib_module_names),
    "javascript": _NODE_BUILTINS,
}

# Import name → distribution name, for the cases where they differ.
IMPORT_TO_PACKAGE: dict[str, dict[str, str]] = {
    "python": {
        "cv2": "opencv-python",
        "PIL": "Pillow",
        "sklearn": "scikit-learn",
        "bs4": "beautifulsoup4",
        "yaml": "PyYAML",
    },
    "javascript": {},
}
