"""Unit tests for UserPreferenceService — all repos mocked."""

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models.user import User
from app.models.user_preference_model import UserPreference
from app.services.user_preference_service import UserPreferenceService


def _make_user(id: int = 1, preference_id: str | None = None) -> User:
    user = User()
    user.id = id
    user.email = "user@example.com"
    user.preference_id = preference_id
    return user


def _make_pref_doc(preferences: dict | None = None) -> UserPreference:
    doc = MagicMock(spec=UserPreference)
    doc.id = "pref-abc"
    doc.preferences = preferences or {}
    return doc


def _make_service(pref_key_repo=None, pref_repo=None, user_repo=None):
    return UserPreferenceService(
        pref_key_repo=pref_key_repo or MagicMock(),
        pref_repo=pref_repo or MagicMock(),
        user_repo=user_repo or MagicMock(),
    )


# ── list_keys / create_key ────────────────────────────────────────────────


class TestListKeys:
    def test_delegates_to_repo(self):
        repo = MagicMock()
        repo.list_all.return_value = ["k1", "k2"]
        svc = _make_service(pref_key_repo=repo)
        assert svc.list_keys() == ["k1", "k2"]


class TestCreateKey:
    def test_creates_when_key_is_new(self):
        repo = MagicMock()
        repo.get_by_key.return_value = None
        repo.create.return_value = MagicMock(key="new_key")
        svc = _make_service(pref_key_repo=repo)
        svc.create_key("new_key", "desc")
        repo.create.assert_called_once_with(key="new_key", description="desc")

    def test_raises_when_key_already_exists(self):
        repo = MagicMock()
        repo.get_by_key.return_value = MagicMock()
        svc = _make_service(pref_key_repo=repo)
        with pytest.raises(ValueError, match="already exists"):
            svc.create_key("lang", "desc")


# ── get_preferences ───────────────────────────────────────────────────────


class TestGetPreferences:
    async def test_returns_empty_when_user_has_no_preference_id(self):
        user_repo = MagicMock()
        user_repo.get_by_id.return_value = _make_user(preference_id=None)
        svc = _make_service(user_repo=user_repo)
        result = await svc.get_preferences(1)
        assert result == {}

    async def test_returns_empty_when_user_not_found(self):
        user_repo = MagicMock()
        user_repo.get_by_id.return_value = None
        svc = _make_service(user_repo=user_repo)
        result = await svc.get_preferences(1)
        assert result == {}

    async def test_returns_preferences_from_mongo_doc(self):
        user_repo = MagicMock()
        user_repo.get_by_id.return_value = _make_user(preference_id="pref-abc")
        pref_repo = MagicMock()
        pref_repo.get_by_id = AsyncMock(return_value=_make_pref_doc({"lang": "python"}))
        svc = _make_service(pref_repo=pref_repo, user_repo=user_repo)
        result = await svc.get_preferences(1)
        assert result == {"lang": "python"}

    async def test_returns_empty_when_mongo_doc_missing(self):
        user_repo = MagicMock()
        user_repo.get_by_id.return_value = _make_user(preference_id="stale-id")
        pref_repo = MagicMock()
        pref_repo.get_by_id = AsyncMock(return_value=None)
        svc = _make_service(pref_repo=pref_repo, user_repo=user_repo)
        result = await svc.get_preferences(1)
        assert result == {}


# ── upsert_preference ─────────────────────────────────────────────────────


class TestUpsertPreference:
    async def test_raises_for_unknown_key(self):
        pref_key_repo = MagicMock()
        pref_key_repo.get_by_key.return_value = None
        svc = _make_service(pref_key_repo=pref_key_repo)
        with pytest.raises(ValueError, match="Unknown preference key"):
            await svc.upsert_preference(1, "bad_key", "value")

    async def test_raises_when_user_not_found(self):
        pref_key_repo = MagicMock()
        pref_key_repo.get_by_key.return_value = MagicMock()
        user_repo = MagicMock()
        user_repo.get_by_id.return_value = None
        svc = _make_service(pref_key_repo=pref_key_repo, user_repo=user_repo)
        with pytest.raises(ValueError, match="User not found"):
            await svc.upsert_preference(1, "lang", "python")

    async def test_creates_new_doc_when_no_preference_id(self):
        pref_key_repo = MagicMock()
        pref_key_repo.get_by_key.return_value = MagicMock()
        user_repo = MagicMock()
        user_repo.get_by_id.return_value = _make_user(preference_id=None)
        doc = _make_pref_doc({"lang": "python"})
        pref_repo = MagicMock()
        pref_repo.create = AsyncMock(return_value=doc)
        pref_repo.upsert_preference = AsyncMock(return_value=doc)
        svc = _make_service(
            pref_key_repo=pref_key_repo, pref_repo=pref_repo, user_repo=user_repo
        )

        result = await svc.upsert_preference(1, "lang", "python")

        pref_repo.create.assert_called_once()
        user_repo.set_preference_id.assert_called_once_with(1, str(doc.id))
        assert result == {"lang": "python"}

    async def test_reuses_existing_doc_when_preference_id_set(self):
        pref_key_repo = MagicMock()
        pref_key_repo.get_by_key.return_value = MagicMock()
        user_repo = MagicMock()
        user_repo.get_by_id.return_value = _make_user(preference_id="pref-abc")
        doc = _make_pref_doc({"lang": "python", "db": "postgres"})
        pref_repo = MagicMock()
        pref_repo.get_by_id = AsyncMock(return_value=doc)
        pref_repo.upsert_preference = AsyncMock(return_value=doc)
        svc = _make_service(
            pref_key_repo=pref_key_repo, pref_repo=pref_repo, user_repo=user_repo
        )

        result = await svc.upsert_preference(1, "db", "postgres")

        pref_repo.create.assert_not_called()
        user_repo.set_preference_id.assert_not_called()
        assert result["db"] == "postgres"
