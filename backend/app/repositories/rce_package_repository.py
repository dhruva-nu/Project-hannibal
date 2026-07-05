from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.models.rce_package_model import RcePackage


class RcePackageRepository:
    def __init__(self, db: Session) -> None:
        self._db = db

    def search_prefix(
        self, language: str, prefix: str, limit: int = 20
    ) -> list[RcePackage]:
        # Cached (runnable) packages first, then alphabetical — the escape keeps
        # a user-typed % or _ from turning into a wildcard.
        pattern = _escape_like(prefix) + "%"
        return (
            self._db.query(RcePackage)
            .filter(RcePackage.language == language)
            .filter(RcePackage.name.ilike(pattern, escape="\\"))
            .order_by(RcePackage.in_cache.desc(), RcePackage.name)
            .limit(limit)
            .all()
        )

    def get(self, language: str, name: str) -> RcePackage | None:
        return self._db.get(RcePackage, {"language": language, "name": name})

    def upsert(self, language: str, name: str, exists: bool) -> RcePackage:
        package = self.get(language, name)
        now = datetime.now(UTC)
        if package is None:
            package = RcePackage(
                language=language, name=name, exists=exists, checked_at=now
            )
            self._db.add(package)
        else:
            package.exists = exists
            package.checked_at = now
        self._db.commit()
        self._db.refresh(package)
        return package


def _escape_like(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
