"""Unit tests for PreferenceKeyRepository and UserPreferenceRepository."""

from unittest.mock import AsyncMock, MagicMock

from app.models.preference_key_model import PreferenceKey
from app.models.user_preference_model import UserPreference
from app.repositories.preference_key_repository import PreferenceKeyRepository
from app.repositories.user_preference_repository import UserPreferenceRepository
from tests.helpers import _db


def _make_key(id: int = 1, key: str = "lang") -> PreferenceKey:
    row = PreferenceKey()
    row.id = id
    row.key = key
    row.description = "Programming language"
    return row


def _make_pref_doc(preferences: dict | None = None) -> UserPreference:
    doc = MagicMock(spec=UserPreference)
    doc.id = "abc-123"
    doc.preferences = preferences or {}
    return doc


# ── PreferenceKeyRepository ────────────────────────────────────────────────


class TestGetByKey:
    def test_returns_row_when_found(self):
        row = _make_key()
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = row
        assert PreferenceKeyRepository(db).get_by_key("lang") is row

    def test_returns_none_when_missing(self):
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = None
        assert PreferenceKeyRepository(db).get_by_key("unknown") is None


class TestListAllKeys:
    def test_returns_all_rows(self):
        rows = [_make_key(1, "lang"), _make_key(2, "db")]
        db = MagicMock()
        db.query.return_value.all.return_value = rows
        assert PreferenceKeyRepository(db).list_all() == rows

    def test_returns_empty_list_when_none(self):
        db = MagicMock()
        db.query.return_value.all.return_value = []
        assert PreferenceKeyRepository(db).list_all() == []


class TestCreateKey:
    def test_adds_commits_and_refreshes(self):
        db = _db()
        PreferenceKeyRepository(db).create(key="lang", description="desc")
        db.add.assert_called_once()
        db.commit.assert_called_once()
        db.refresh.assert_called_once()

    def test_returns_new_row(self):
        db = _db()
        result = PreferenceKeyRepository(db).create(key="lang", description="desc")
        assert result.key == "lang"
        assert result.description == "desc"


# ── UserPreferenceRepository ───────────────────────────────────────────────


class TestUserPreferenceGetById:
    async def test_returns_doc_when_found(self, mocker):
        doc = _make_pref_doc()
        mocker.patch.object(UserPreference, "get", new=AsyncMock(return_value=doc))
        result = await UserPreferenceRepository().get_by_id("abc-123")
        assert result is doc

    async def test_returns_none_when_missing(self, mocker):
        mocker.patch.object(UserPreference, "get", new=AsyncMock(return_value=None))
        result = await UserPreferenceRepository().get_by_id("missing")
        assert result is None


class TestUserPreferenceCreate:
    async def test_inserts_and_returns_doc(self, mocker):
        doc = MagicMock(spec=UserPreference)
        doc.id = "new-id"
        doc.preferences = {}
        doc.insert = AsyncMock()

        mocker.patch(
            "app.repositories.user_preference_repository.UserPreference",
            return_value=doc,
        )
        result = await UserPreferenceRepository().create()
        doc.insert.assert_called_once()
        assert result is doc


class TestUserPreferenceUpsert:
    async def test_sets_key_and_saves(self):
        doc = MagicMock(spec=UserPreference)
        doc.preferences = {}
        doc.save = AsyncMock()

        result = await UserPreferenceRepository().upsert_preference(
            doc, "lang", "python"
        )

        assert doc.preferences["lang"] == "python"
        doc.save.assert_called_once()
        assert result is doc

    async def test_overwrites_existing_key(self):
        doc = MagicMock(spec=UserPreference)
        doc.preferences = {"lang": "javascript"}
        doc.save = AsyncMock()

        await UserPreferenceRepository().upsert_preference(doc, "lang", "python")

        assert doc.preferences["lang"] == "python"
