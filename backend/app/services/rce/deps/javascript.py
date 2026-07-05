"""JavaScript / Node dependency support, backed by the tree-sitter grammar.

The query captures the specifier of every static ``import``/``export … from``,
``require(...)`` call, and dynamic ``import(...)`` under ``@spec``. The ``#eq?``
predicate limits call matches to ``require``, so ordinary calls such as
``console.log('x')`` are not mistaken for imports.
"""

from .provider import DepsProvider
from .treesitter import TreeSitterImportDetector

# Node built-in modules — never installed, importable with or without "node:".
_NODE_BUILTINS = frozenset(
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

_IMPORT_QUERY = """
(import_statement source: (string (string_fragment) @spec))
(export_statement source: (string (string_fragment) @spec))
(call_expression
  function: (identifier) @_fn (#eq? @_fn "require")
  arguments: (arguments (string (string_fragment) @spec)))
(call_expression
  function: (import)
  arguments: (arguments (string (string_fragment) @spec)))
"""


def _specifier_to_package(specifier: str) -> str | None:
    """Reduce an import specifier to its package name.

    ``lodash/fp`` → ``lodash``; ``@scope/pkg/sub`` → ``@scope/pkg``;
    ``node:fs`` → ``fs``. Relative and absolute paths are not packages.
    """
    if specifier.startswith((".", "/")):
        return None
    specifier = specifier.removeprefix("node:")
    parts = specifier.split("/")
    if specifier.startswith("@"):
        return "/".join(parts[:2])
    return parts[0]


JAVASCRIPT_PROVIDER = DepsProvider(
    language="javascript",
    allowlist=frozenset({"axios", "bcrypt", "lodash"}),
    cache_volume="rce-cache-node",
    cache_path="/opt/rce-cache/node",
    # npm installs into <prefix>/node_modules, so resolution points there.
    runtime_env={"NODE_PATH": "/opt/rce-cache/node/node_modules"},
    detector=TreeSitterImportDetector(
        grammar="javascript",
        query=_IMPORT_QUERY,
        normalise=_specifier_to_package,
    ),
    stdlib=_NODE_BUILTINS,
)
