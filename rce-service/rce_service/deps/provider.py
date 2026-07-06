"""The language-agnostic dependency abstraction.

A ``DepsProvider`` bundles everything the executor needs to reason about one
language's third-party dependencies: how imports are found (``ImportDetector``),
which packages are permitted (``allowlist``), which imports are the language's
own standard library, how import names map to distribution names, and where the
package cache lives at run time. The orchestrator only ever touches
``RUNTIME[language]["deps"]`` — it never learns a language's specifics.
"""

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Protocol

from ..exceptions import UnpermittedDependency


class ImportDetector(Protocol):
    """Extracts the imported module/package names from source code.

    Implementations parse real syntax (an AST or grammar), never string
    matching. They report raw import names; stdlib filtering, name mapping and
    allowlist enforcement are the provider's job, not the detector's.
    """

    def detect(self, code: str) -> list[str]: ...


@dataclass(frozen=True)
class DepsProvider:
    language: str
    allowlist: frozenset[str]
    cache_volume: str  # named Docker volume backing the global cache (SUB2)
    cache_path: str  # where that volume mounts inside install/run containers
    runtime_env: dict[str, str]  # env the run container needs to find the cache
    detector: ImportDetector
    # (packages, cache_dir) → the package-manager command that installs into the
    # cache with install scripts disabled. The installer (SUB3) runs exactly
    # this — never student code — during the network-on phase.
    install_cmd: Callable[[list[str], str], list[str]]
    stdlib: frozenset[str] = frozenset()
    import_to_package: dict[str, str] = field(default_factory=dict)

    def dependencies(self, code: str) -> list[str]:
        """Third-party packages the code imports.

        Standard-library imports are dropped, import names are mapped to their
        distribution name where they differ (e.g. ``cv2`` → ``opencv-python``),
        and the result is de-duplicated in first-seen order.
        """
        packages: list[str] = []
        seen: set[str] = set()
        for name in self.detector.detect(code):
            if name in self.stdlib:
                continue
            package = self.import_to_package.get(name, name)
            if package not in seen:
                seen.add(package)
                packages.append(package)
        return packages

    def resolve(self, code: str) -> list[str]:
        """The code's dependencies, guaranteed all allowlisted.

        Raises ``UnpermittedDependency`` on the first package not permitted for
        this language — fail loudly rather than silently dropping an import.
        """
        packages = self.dependencies(code)
        for package in packages:
            if package not in self.allowlist:
                raise UnpermittedDependency(package, self.language)
        return packages
