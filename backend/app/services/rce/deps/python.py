"""Python dependency support, backed by the standard-library ``ast`` parser.

Python is detected with its own canonical parser rather than tree-sitter: it is
zero-dependency and strictly correct for the language we care most about. The
``ImportDetector`` interface keeps it interchangeable with the grammar-based
detectors used for the other languages.
"""

import ast
import sys

from .provider import DepsProvider


def _top_level(module: str) -> str:
    """``numpy.linalg`` → ``numpy``; ``os.path`` → ``os``."""
    return module.split(".", 1)[0]


class PythonImportDetector:
    def detect(self, code: str) -> list[str]:
        # Unparseable code cannot run, so it has no dependencies to install —
        # it reaches the sandbox and shows the interpreter's own SyntaxError.
        try:
            tree = ast.parse(code)
        except SyntaxError:
            return []

        modules: list[str] = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                modules.extend(_top_level(alias.name) for alias in node.names)
            elif isinstance(node, ast.ImportFrom):
                # level > 0 is a relative import (``from . import x``) — no package.
                if node.level == 0 and node.module:
                    modules.append(_top_level(node.module))
        return modules


# Import name → PyPI distribution name, for the cases where they differ.
# Seeds the mapping hook; extend as the allowlist grows.
_IMPORT_TO_PACKAGE = {
    "cv2": "opencv-python",
    "PIL": "Pillow",
    "sklearn": "scikit-learn",
    "bs4": "beautifulsoup4",
    "yaml": "PyYAML",
}

PYTHON_PROVIDER = DepsProvider(
    language="python",
    allowlist=frozenset({"numpy", "pandas", "requests", "bcrypt"}),
    cache_volume="rce-cache-python",
    runtime_env={"PYTHONPATH": "/opt/rce-cache/python"},
    detector=PythonImportDetector(),
    stdlib=frozenset(sys.stdlib_module_names),
    import_to_package=_IMPORT_TO_PACKAGE,
)
