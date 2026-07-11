"""Unit tests for FeatureFlagService — repository is fully mocked."""

from unittest.mock import MagicMock

import pytest

from app.models.feature_flag_model import FeatureFlag
from app.schemas.feature_flag import FeatureFlagUpdate
from app.services.feature_flag_service import FeatureFlagService, _bucket


def _make_flag(
    key: str = "new-ui",
    description: str = "new sidebar",
    enabled: bool = True,
    rollout_percentage: int = 100,
    target_roles: list[str] | None = None,
) -> FeatureFlag:
    flag = FeatureFlag()
    flag.id = 1
    flag.key = key
    flag.description = description
    flag.enabled = enabled
    flag.rollout_percentage = rollout_percentage
    flag.target_roles = target_roles
    flag.created_at = MagicMock()
    flag.updated_at = MagicMock()
    return flag


def _make_service(repo=None) -> FeatureFlagService:
    return FeatureFlagService(repository=repo or MagicMock())


class TestBucket:
    def test_is_in_range(self):
        assert 0 <= _bucket("flag", 1) < 100

    def test_is_deterministic(self):
        assert _bucket("flag", 42) == _bucket("flag", 42)

    def test_varies_by_user(self):
        buckets = {_bucket("flag", uid) for uid in range(50)}
        assert len(buckets) > 1

    def test_varies_by_key(self):
        buckets = {_bucket(f"flag-{i}", 1) for i in range(50)}
        assert len(buckets) > 1


class TestEvaluateForUser:
    def test_kill_switch_off_returns_false(self):
        repo = MagicMock()
        repo.get_all.return_value = [_make_flag(enabled=False, rollout_percentage=100)]
        result = _make_service(repo).evaluate_for_user(1, "student")
        assert result == {"new-ui": False}

    def test_full_rollout_returns_true(self):
        repo = MagicMock()
        repo.get_all.return_value = [_make_flag(rollout_percentage=100)]
        result = _make_service(repo).evaluate_for_user(1, "student")
        assert result == {"new-ui": True}

    def test_zero_rollout_returns_false(self):
        repo = MagicMock()
        repo.get_all.return_value = [_make_flag(rollout_percentage=0)]
        result = _make_service(repo).evaluate_for_user(1, "student")
        assert result == {"new-ui": False}

    def test_targeted_role_bypasses_zero_rollout(self):
        repo = MagicMock()
        repo.get_all.return_value = [
            _make_flag(rollout_percentage=0, target_roles=["admin"])
        ]
        result = _make_service(repo).evaluate_for_user(1, "admin")
        assert result == {"new-ui": True}

    def test_untargeted_role_falls_through_to_rollout(self):
        repo = MagicMock()
        repo.get_all.return_value = [
            _make_flag(rollout_percentage=0, target_roles=["admin"])
        ]
        result = _make_service(repo).evaluate_for_user(1, "student")
        assert result == {"new-ui": False}

    def test_disabled_flag_ignores_targeting(self):
        repo = MagicMock()
        repo.get_all.return_value = [
            _make_flag(enabled=False, rollout_percentage=100, target_roles=["admin"])
        ]
        result = _make_service(repo).evaluate_for_user(1, "admin")
        assert result == {"new-ui": False}

    def test_evaluation_is_deterministic(self):
        repo = MagicMock()
        repo.get_all.return_value = [_make_flag(rollout_percentage=50)]
        svc = _make_service(repo)
        first = svc.evaluate_for_user(7, "student")
        second = svc.evaluate_for_user(7, "student")
        assert first == second

    def test_empty_returns_empty_map(self):
        repo = MagicMock()
        repo.get_all.return_value = []
        assert _make_service(repo).evaluate_for_user(1, "student") == {}


class TestListFlags:
    def test_returns_all(self):
        repo = MagicMock()
        repo.get_all.return_value = [_make_flag("a"), _make_flag("b")]
        result = _make_service(repo).list_flags()
        assert [f.key for f in result] == ["a", "b"]


class TestGetFlag:
    def test_found(self):
        repo = MagicMock()
        repo.get_by_key.return_value = _make_flag()
        assert _make_service(repo).get_flag("new-ui").key == "new-ui"

    def test_not_found_raises(self):
        repo = MagicMock()
        repo.get_by_key.return_value = None
        with pytest.raises(ValueError, match="not found"):
            _make_service(repo).get_flag("missing")


class TestCreateFlag:
    def test_success(self):
        repo = MagicMock()
        repo.get_by_key.return_value = None
        repo.create.return_value = _make_flag()
        result = _make_service(repo).create_flag(
            key="new-ui",
            description="d",
            enabled=True,
            rollout_percentage=10,
            target_roles=None,
        )
        assert result.key == "new-ui"

    def test_duplicate_raises(self):
        repo = MagicMock()
        repo.get_by_key.return_value = _make_flag()
        with pytest.raises(ValueError, match="already exists"):
            _make_service(repo).create_flag(
                key="new-ui",
                description="d",
                enabled=True,
                rollout_percentage=10,
                target_roles=None,
            )


class TestUpdateFlag:
    def test_success(self):
        repo = MagicMock()
        existing = _make_flag()
        repo.get_by_key.return_value = existing
        repo.update.return_value = _make_flag(rollout_percentage=50)
        result = _make_service(repo).update_flag(
            "new-ui", FeatureFlagUpdate(rollout_percentage=50)
        )
        assert result.rollout_percentage == 50

    def test_not_found_raises(self):
        repo = MagicMock()
        repo.get_by_key.return_value = None
        with pytest.raises(ValueError, match="not found"):
            _make_service(repo).update_flag("missing", FeatureFlagUpdate())

    def test_explicit_null_clears_target_roles(self):
        repo = MagicMock()
        repo.get_by_key.return_value = _make_flag(target_roles=["admin"])
        repo.update.return_value = _make_flag()
        _make_service(repo).update_flag("new-ui", FeatureFlagUpdate(target_roles=None))
        _, kwargs = repo.update.call_args
        assert kwargs["clear_target_roles"] is True

    def test_omitted_target_roles_does_not_clear(self):
        repo = MagicMock()
        repo.get_by_key.return_value = _make_flag(target_roles=["admin"])
        repo.update.return_value = _make_flag()
        _make_service(repo).update_flag("new-ui", FeatureFlagUpdate(enabled=False))
        _, kwargs = repo.update.call_args
        assert kwargs["clear_target_roles"] is False


class TestDeleteFlag:
    def test_success(self):
        repo = MagicMock()
        repo.get_by_key.return_value = _make_flag()
        _make_service(repo).delete_flag("new-ui")
        repo.delete.assert_called_once()

    def test_not_found_raises(self):
        repo = MagicMock()
        repo.get_by_key.return_value = None
        with pytest.raises(ValueError, match="not found"):
            _make_service(repo).delete_flag("missing")
