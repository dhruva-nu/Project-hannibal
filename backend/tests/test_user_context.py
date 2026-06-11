"""Unit tests for build_user_memory — all I/O mocked."""

from unittest.mock import AsyncMock, MagicMock, patch

from app.agent.user_context import build_user_memory
from app.models.user import User
from app.models.user_preference_model import UserPreference


def _make_user(
    user_id: int = 1,
    role: str = "student",
    preference_id: str | None = None,
) -> User:
    user = User()
    user.id = user_id
    user.email = "test@example.com"
    user.role = role
    user.preference_id = preference_id
    return user


def _make_pref_doc(preferences: dict) -> UserPreference:
    doc = MagicMock(spec=UserPreference)
    doc.preferences = preferences
    return doc


class TestBuildUserMemory:
    async def test_returns_empty_when_user_not_found(self):
        with (
            patch("app.agent.user_context.UserRepository") as mock_repo_cls,
            patch("app.agent.user_context.get_db"),
        ):
            mock_repo_cls.return_value.get_by_id.return_value = None
            result = await build_user_memory(999)
        assert result == ""

    async def test_returns_identity_only_when_no_preference_id(self):
        user = _make_user(preference_id=None)
        with (
            patch("app.agent.user_context.UserRepository") as mock_repo_cls,
            patch("app.agent.user_context.get_db"),
        ):
            mock_repo_cls.return_value.get_by_id.return_value = user
            result = await build_user_memory(1)
        assert "Role: student" in result
        assert "Preferences" not in result

    async def test_returns_identity_and_preferences(self):
        user = _make_user(preference_id="pref-abc")
        prefs = {"lang": "python", "db": "postgres"}
        with (
            patch("app.agent.user_context.UserRepository") as mock_repo_cls,
            patch("app.agent.user_context.get_db"),
            patch("app.agent.user_context.UserPreferenceRepository") as mock_pref_cls,
        ):
            mock_repo_cls.return_value.get_by_id.return_value = user
            mock_pref_cls.return_value.get_by_id = AsyncMock(
                return_value=_make_pref_doc(prefs)
            )
            result = await build_user_memory(1)
        assert "Role: student" in result
        assert "lang=python" in result
        assert "db=postgres" in result

    async def test_omits_preferences_line_when_mongo_doc_missing(self):
        user = _make_user(preference_id="stale-id")
        with (
            patch("app.agent.user_context.UserRepository") as mock_repo_cls,
            patch("app.agent.user_context.get_db"),
            patch("app.agent.user_context.UserPreferenceRepository") as mock_pref_cls,
        ):
            mock_repo_cls.return_value.get_by_id.return_value = user
            mock_pref_cls.return_value.get_by_id = AsyncMock(return_value=None)
            result = await build_user_memory(1)
        assert "Role: student" in result
        assert "Preferences" not in result

    async def test_omits_preferences_line_when_prefs_dict_empty(self):
        user = _make_user(preference_id="pref-abc")
        with (
            patch("app.agent.user_context.UserRepository") as mock_repo_cls,
            patch("app.agent.user_context.get_db"),
            patch("app.agent.user_context.UserPreferenceRepository") as mock_pref_cls,
        ):
            mock_repo_cls.return_value.get_by_id.return_value = user
            mock_pref_cls.return_value.get_by_id = AsyncMock(
                return_value=_make_pref_doc({})
            )
            result = await build_user_memory(1)
        assert "Preferences" not in result
