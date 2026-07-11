from unittest.mock import MagicMock

from app.repositories.feature_flag_repository import FeatureFlagRepository
from tests.helpers import _chain, _db


class TestFeatureFlagRepository:
    def test_init_stores_db(self):
        db = _db()
        repo = FeatureFlagRepository(db)
        assert repo._db is db

    def test_get_all(self):
        db = _db()
        db.query.return_value.all.return_value = []
        repo = FeatureFlagRepository(db)
        assert repo.get_all() == []

    def test_get_by_key_found(self):
        flag = MagicMock()
        repo = FeatureFlagRepository(_chain(_db(), flag))
        assert repo.get_by_key("new-ui") is flag

    def test_get_by_key_not_found(self):
        repo = FeatureFlagRepository(_chain(_db(), None))
        assert repo.get_by_key("missing") is None

    def test_create_adds_and_returns(self):
        db = _db()
        repo = FeatureFlagRepository(db)
        repo.create(
            key="new-ui",
            description="new sidebar",
            enabled=True,
            rollout_percentage=25,
            target_roles=["admin"],
        )
        db.add.assert_called_once()
        db.commit.assert_called_once()
        db.refresh.assert_called_once()

    def test_update_sets_all_fields(self):
        flag = MagicMock()
        db = _db()
        repo = FeatureFlagRepository(db)
        repo.update(
            flag,
            description="updated",
            enabled=False,
            rollout_percentage=80,
            target_roles=["student"],
            clear_target_roles=False,
        )
        assert flag.description == "updated"
        assert flag.enabled is False
        assert flag.rollout_percentage == 80
        assert flag.target_roles == ["student"]
        db.commit.assert_called_once()

    def test_update_skips_none_fields(self):
        flag = MagicMock()
        flag.description = "unchanged"
        db = _db()
        repo = FeatureFlagRepository(db)
        repo.update(
            flag,
            description=None,
            enabled=None,
            rollout_percentage=None,
            target_roles=None,
            clear_target_roles=False,
        )
        assert flag.description == "unchanged"
        db.commit.assert_called_once()

    def test_update_clears_target_roles(self):
        flag = MagicMock()
        db = _db()
        repo = FeatureFlagRepository(db)
        repo.update(
            flag,
            description=None,
            enabled=None,
            rollout_percentage=None,
            target_roles=None,
            clear_target_roles=True,
        )
        assert flag.target_roles is None
        db.commit.assert_called_once()

    def test_delete_removes_flag(self):
        flag = MagicMock()
        db = _db()
        repo = FeatureFlagRepository(db)
        repo.delete(flag)
        db.delete.assert_called_once_with(flag)
        db.commit.assert_called_once()
