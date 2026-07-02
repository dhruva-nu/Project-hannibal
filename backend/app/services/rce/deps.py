"""Per-language dependency providers for the code-execution sandbox.

A ``DepsProvider`` teaches the executor, for one language, how to turn student
source into the list of third-party packages it needs, and enforces a curated
allowlist. Everything language-specific (how imports are parsed, which packages
are permitted, where the package cache lives, how the runtime resolves it) is
captured here; the orchestrator stays language-agnostic and only ever touches
``RUNTIME[language]["deps"]``.

Adding a language = adding one ``DepsProvider`` entry to ``DEPS_PROVIDERS``.
"""

import ast
import re
import sys
from collections.abc import Callable
from dataclasses import dataclass, field

from app.exception.rce_exception import UnpermittedDependency

# ── Python import detection ─────────────────────────────────────────────────

_PYTHON_STDLIB = frozenset(sys.stdlib_module_names)

_PYTHON_IMPORT_RE = re.compile(r"^\s*(?:import|from)\s+([a-zA-Z0-9_.]+)", re.MULTILINE)


def _top_level(module: str) -> str:
    """``os.path`` → ``os``; ``numpy.linalg`` → ``numpy``."""
    return module.split(".", 1)[0]


def _detect_python_regex(code: str) -> list[str]:
    """Fallback used when the source does not parse (student syntax errors).

    Detection must never crash the run — bad code is meant to reach the sandbox
    and show the interpreter's traceback, not 500 here.
    """
    return [_top_level(m) for m in _PYTHON_IMPORT_RE.findall(code)]


def _detect_python(code: str) -> list[str]:
    try:
        tree = ast.parse(code)
    except SyntaxError:
        return _detect_python_regex(code)

    modules: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            modules.extend(_top_level(alias.name) for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            # level > 0 is a relative import (``from . import x``) — no package.
            if node.level == 0 and node.module:
                modules.append(_top_level(node.module))
    return modules


# ── JavaScript / Node import detection ──────────────────────────────────────

# Node built-in modules — never installed, importable with or without "node:".
_NODE_BUILTINS = frozenset(
    {
        "assert",
        "async_hooks",
        "buffer",
        "child_process",
        "cluster",
        "console",
        "constants",
        "crypto",
        "dgram",
        "diagnostics_channel",
        "dns",
        "domain",
        "events",
        "fs",
        "http",
        "http2",
        "https",
        "inspector",
        "module",
        "net",
        "os",
        "path",
        "perf_hooks",
        "process",
        "punycode",
        "querystring",
        "readline",
        "repl",
        "stream",
        "string_decoder",
        "sys",
        "timers",
        "tls",
        "trace_events",
        "tty",
        "url",
        "util",
        "v8",
        "vm",
        "wasi",
        "worker_threads",
        "zlib",
    }
)

_JS_FROM_RE = re.compile(r"""\bfrom\s+['"]([^'"]+)['"]""")
_JS_REQUIRE_RE = re.compile(r"""\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)""")
_JS_SIDE_EFFECT_IMPORT_RE = re.compile(r"""\bimport\s+['"]([^'"]+)['"]""")
_JS_DYNAMIC_IMPORT_RE = re.compile(r"""\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)""")


def _js_package_name(specifier: str) -> str | None:
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


def _detect_javascript(code: str) -> list[str]:
    specifiers: list[str] = []
    for pattern in (
        _JS_FROM_RE,
        _JS_REQUIRE_RE,
        _JS_SIDE_EFFECT_IMPORT_RE,
        _JS_DYNAMIC_IMPORT_RE,
    ):
        specifiers.extend(pattern.findall(code))

    packages: list[str] = []
    for specifier in specifiers:
        name = _js_package_name(specifier)
        if name is not None:
            packages.append(name)
    return packages


# ── Provider ────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class DepsProvider:
    """How one language sources, names, and permits its dependencies."""

    language: str
    allowlist: frozenset[str]
    cache_volume: str  # named Docker volume backing the global cache (SUB2)
    runtime_env: dict[str, str]  # env the run container needs to find the cache
    detector: Callable[[str], list[str]]
    stdlib: frozenset[str] = frozenset()
    import_to_package: dict[str, str] = field(default_factory=dict)

    def detect(self, code: str) -> list[str]:
        """Third-party packages the code imports, de-duplicated, stdlib removed.

        Import names are mapped to their distribution name where they differ
        (e.g. ``cv2`` → ``opencv-python``) via ``import_to_package``.
        """
        packages: list[str] = []
        seen: set[str] = set()
        for name in self.detector(code):
            if name in self.stdlib:
                continue
            package = self.import_to_package.get(name, name)
            if package not in seen:
                seen.add(package)
                packages.append(package)
        return packages

    def resolve(self, code: str) -> list[str]:
        """Detected packages, guaranteed all allowlisted.

        Raises ``UnpermittedDependency`` on the first package not permitted for
        this language — fail loudly rather than silently dropping an import.
        """
        packages = self.detect(code)
        for package in packages:
            if package not in self.allowlist:
                raise UnpermittedDependency(package, self.language)
        return packages


# ── Language registry ────────────────────────────────────────────────────────

# Import name → PyPI distribution name, for the cases where they differ.
# Seeds the mapping hook; extend as the allowlist grows.
_PYTHON_IMPORT_TO_PACKAGE = {
    "cv2": "opencv-python",
    "PIL": "Pillow",
    "sklearn": "scikit-learn",
    "bs4": "beautifulsoup4",
    "yaml": "PyYAML",
}

DEPS_PROVIDERS: dict[str, DepsProvider] = {
    "python": DepsProvider(
        language="python",
        allowlist=frozenset({"numpy", "pandas", "requests", "bcrypt"}),
        cache_volume="rce-cache-python",
        runtime_env={"PYTHONPATH": "/opt/rce-cache/python"},
        detector=_detect_python,
        stdlib=_PYTHON_STDLIB,
        import_to_package=_PYTHON_IMPORT_TO_PACKAGE,
    ),
    "javascript": DepsProvider(
        language="javascript",
        allowlist=frozenset({"axios", "bcrypt", "lodash"}),
        cache_volume="rce-cache-node",
        runtime_env={"NODE_PATH": "/opt/rce-cache/node"},
        detector=_detect_javascript,
        stdlib=_NODE_BUILTINS,
    ),
}
