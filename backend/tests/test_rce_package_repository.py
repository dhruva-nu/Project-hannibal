from app.repositories.rce_package_repository import RcePackageRepository, _escape_like
from tests.helpers import _db


def _search_chain(db, rows):
    (
        db.query.return_value.filter.return_value.filter.return_value.order_by.return_value.limit.return_value.all.return_value
    ) = rows
    return db


class TestSearchPrefix:
    def test_returns_rows(self):
        db = _search_chain(_db(), ["requests", "regex"])
        repo = RcePackageRepository(db)
        assert repo.search_prefix("python", "re") == ["requests", "regex"]

    def test_default_limit_applied(self):
        db = _search_chain(_db(), [])
        repo = RcePackageRepository(db)
        repo.search_prefix("python", "re")
        db.query.return_value.filter.return_value.filter.return_value.order_by.return_value.limit.assert_called_once_with(
            20
        )

    def test_wildcards_in_prefix_are_escaped(self):
        # A user-typed % or _ must not become a LIKE wildcard.
        assert _escape_like("50%_x") == "50\\%\\_x"
        assert _escape_like("a\\b") == "a\\\\b"


class TestGet:
    def test_delegates_to_session_get(self):
        db = _db()
        db.get.return_value = "row"
        repo = RcePackageRepository(db)
        assert repo.get("python", "requests") == "row"
        db.get.assert_called_once()


class TestUpsert:
    def test_insert_when_absent(self):
        db = _db()
        db.get.return_value = None
        repo = RcePackageRepository(db)
        repo.upsert("python", "httpx", exists=True)
        db.add.assert_called_once()
        db.commit.assert_called_once()

    def test_update_when_present(self, mocker):
        db = _db()
        existing = mocker.MagicMock()
        db.get.return_value = existing
        repo = RcePackageRepository(db)
        repo.upsert("python", "requests", exists=False)
        assert existing.exists is False
        db.add.assert_not_called()
        db.commit.assert_called_once()
