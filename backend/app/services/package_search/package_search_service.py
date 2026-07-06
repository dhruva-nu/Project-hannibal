"""Editor-facing package lookup: prefix search + existence verification.

Search hits only the local index (fast — one indexed query). Verify consults
the index first and only reaches out to the registry on a miss, caching the
verdict back into the index so the next lookup is instant.
"""

from collections.abc import Callable

from app.repositories.rce_package_repository import RcePackageRepository
from app.schemas.rce_packages import PackageVerifyResponse

from . import package_meta, registry_client

ExistenceChecker = Callable[[str, str], bool | None]


class PackageSearchService:
    def __init__(
        self,
        repository: RcePackageRepository,
        existence_checker: ExistenceChecker = registry_client.exists,
    ) -> None:
        self._repository = repository
        self._exists = existence_checker

    def search(self, language: str, query: str) -> list[str]:
        self._require_supported(language)
        query = query.strip()
        if not query:
            return []
        rows = self._repository.search_prefix(language, query)
        return [row.name for row in rows]

    def verify(self, language: str, name: str) -> PackageVerifyResponse:
        self._require_supported(language)
        name = name.strip()
        if not name:
            raise ValueError("Package name must not be empty")

        # Standard-library modules are always available and never on a registry —
        # verifying them against PyPI/npm would wrongly flag them as missing.
        if name in package_meta.STDLIB[language]:
            return PackageVerifyResponse(name=name, exists=True, in_cache=True)

        # The import name can differ from the distribution name (cv2 -> opencv-python).
        package = package_meta.IMPORT_TO_PACKAGE[language].get(name, name)

        known = self._repository.get(language, package)
        if known is not None:
            return PackageVerifyResponse(
                name=name, exists=known.exists, in_cache=known.in_cache
            )

        exists = self._exists(package, language)
        if exists is None:
            # Registry unreachable — stay neutral, do not poison the index.
            return PackageVerifyResponse(name=name, exists=None, in_cache=False)

        self._repository.upsert(language, package, exists=exists)
        return PackageVerifyResponse(name=name, exists=exists, in_cache=False)

    @staticmethod
    def _require_supported(language: str) -> None:
        if language not in package_meta.SUPPORTED_LANGS:
            raise ValueError(f"Unsupported language: {language}")
