"""Seed the rce_packages deps index with a curated popular set.

Standalone and idempotent (upsert by primary key) — safe to re-run and does
NOT touch other tables. Run from the backend dir:

    uv run python scripts/seed_rce_packages.py

The curated names live in data/popular_packages.json. Everything is marked
exists=true; the `in_cache` names are additionally flagged as installed in the
sandbox volume (the runnable set).
"""

import json
import sys
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_BACKEND_ROOT))

from app.db.session import SessionLocal  # noqa: E402
from app.repositories.rce_package_repository import RcePackageRepository  # noqa: E402

_DATA_FILE = _BACKEND_ROOT / "data" / "popular_packages.json"


def seed() -> None:
    data = json.loads(_DATA_FILE.read_text())
    popular: dict[str, list[str]] = data["popular"]
    in_cache: dict[str, list[str]] = data["in_cache"]

    db = SessionLocal()
    try:
        repository = RcePackageRepository(db)
        total = 0
        for language, names in popular.items():
            cached = set(in_cache.get(language, []))
            for name in names:
                package = repository.upsert(language, name, exists=True)
                package.in_cache = name in cached
                total += 1
            db.commit()
        print(f"Seeded {total} packages across {len(popular)} languages.")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
