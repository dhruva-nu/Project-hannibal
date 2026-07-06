"""The language → provider registry.

The single place a new language is wired in: add its provider here (and its
runtime image in ``config.py``). Nothing in the orchestrator changes.
"""

from .javascript import JAVASCRIPT_PROVIDER
from .provider import DepsProvider
from .python import PYTHON_PROVIDER

DEPS_PROVIDERS: dict[str, DepsProvider] = {
    "python": PYTHON_PROVIDER,
    "javascript": JAVASCRIPT_PROVIDER,
}
