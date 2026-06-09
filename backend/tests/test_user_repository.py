from unittest.mock import MagicMock

from app.repositories.user_repository import UserRepository
from tests.helpers import _chain, _db


class TestUserRepository:
    def test_init_stores_db(self):
        db = _db()
        repo = UserRepository(db)
        assert repo._db is db

    def test_get_by_email_found(self):
        mock_user = MagicMock()
        repo = UserRepository(_chain(_db(), mock_user))
        assert repo.get_by_email("u@x.com") is mock_user

    def test_get_by_email_not_found(self):
        repo = UserRepository(_chain(_db(), None))
        assert repo.get_by_email("nobody@x.com") is None

    def test_get_by_id_found(self):
        mock_user = MagicMock()
        repo = UserRepository(_chain(_db(), mock_user))
        assert repo.get_by_id(1) is mock_user

    def test_get_by_oauth_id_found(self):
        mock_user = MagicMock()
        repo = UserRepository(_chain(_db(), mock_user))
        assert repo.get_by_oauth_id("google", "gid") is mock_user

    def test_get_or_create_finds_by_oauth_id(self):
        mock_user = MagicMock()
        repo = UserRepository(_chain(_db(), mock_user))
        assert repo.get_or_create_oauth_user("e@x.com", "google", "gid") is mock_user

    def test_get_or_create_updates_existing_email_user(self):
        existing = MagicMock()
        db = _db()
        db.query.return_value.filter.return_value.first.side_effect = [None, existing]
        repo = UserRepository(db)
        result = repo.get_or_create_oauth_user("e@x.com", "google", "gid")
        assert result is existing
        assert existing.provider == "google"
        assert existing.oauth_id == "gid"
        db.commit.assert_called()
        db.refresh.assert_called_with(existing)

    def test_get_or_create_creates_new_when_not_found(self):
        db = _db()
        db.query.return_value.filter.return_value.first.return_value = None
        repo = UserRepository(db)
        repo.get_or_create_oauth_user("new@x.com", "google", "gid")
        db.add.assert_called_once()
        db.commit.assert_called()

    def test_create_adds_and_returns_user(self):
        db = _db()
        repo = UserRepository(db)
        repo.create("e@x.com", "hashed", "local", None)
        db.add.assert_called_once()
        db.commit.assert_called()
        db.refresh.assert_called()

    def test_set_preference_id_updates_and_commits(self):
        user = MagicMock()
        repo = UserRepository(_chain(_db(), user))
        repo.set_preference_id(1, "pref-abc")
        assert user.preference_id == "pref-abc"
        repo._db.commit.assert_called_once()

    def test_set_preference_id_noop_when_user_not_found(self):
        repo = UserRepository(_chain(_db(), None))
        repo.set_preference_id(999, "pref-abc")
        repo._db.commit.assert_not_called()
