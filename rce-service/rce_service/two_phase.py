"""Phase one of two-phase execution: resolve → ensure cache → (then run).

The run phase never changes posture — network off, read-only, nobody. All
this module adds in front of it is dependency readiness: parse the code's
imports (SUB1), enforce the allowlist, and make sure every package is in the
global cache (SUB4 queue → SUB3 installer) before a run container starts.

Language-agnostic on purpose: everything specific comes from
``RUNTIME[language]["deps"]``, so new languages plug in with zero changes here.
"""

from .config import RUNTIME
from .install_queue import install_queue


async def prepare_dependencies(code: str, language: str) -> list[str]:
    """Block until the code's dependencies are runnable from the cache.

    Raises ``UnpermittedDependency`` for imports off the allowlist and
    ``DependencyInstallError`` when the cold path fails; the fast path
    (stdlib-only code, or everything already cached) costs one parse.
    """
    provider = RUNTIME[language]["deps"]
    packages = provider.resolve(code)
    if packages:
        await install_queue.ensure(provider, packages)
    return packages
