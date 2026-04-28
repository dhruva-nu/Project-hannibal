"""Unit tests for repository classes — SQLAlchemy session is fully mocked."""
from datetime import datetime, timezone
from unittest.mock import MagicMock, call

import pytest

from app.repositories.base import Repository
from app.repositories.health_repository import HealthRepository
from app.repositories.refresh_token_repository import RefreshTokenRepository
from app.repositories.user_repository import UserRepository


# ── Repository protocol ────────────────────────────────────────────────────

def test_repository_protocol_is_importable():
    assert Repository is not None


# ── HealthRepository ───────────────────────────────────────────────────────

class TestHealthRepository:
    def test_get_returns_ok_payload(self):
        result = HealthRepository().get()
        assert result.status == "ok"
        assert result.service == "backend"


# ── UserRepository ─────────────────────────────────────────────────────────

def _db():
    return MagicMock()


def _chain(db, return_value):
    """Configure db.query(...).filter(...).first() to return *return_value*."""
    db.query.return_value.filter.return_value.first.return_value = return_value
    return db


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
        # First call (get_by_oauth_id) → None; second (get_by_email) → existing
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
        result = repo.create("e@x.com", "hashed", "local", None)
        db.add.assert_called_once()
        db.commit.assert_called()
        db.refresh.assert_called()


# ── RefreshTokenRepository ─────────────────────────────────────────────────

class TestRefreshTokenRepository:
    def test_init_stores_db(self):
        db = _db()
        repo = RefreshTokenRepository(db)
        assert repo._db is db

    def test_create_adds_token(self):
        db = _db()
        repo = RefreshTokenRepository(db)
        expires = datetime.now(timezone.utc)
        repo.create(user_id=1, jti="jti-abc", expires_at=expires)
        db.add.assert_called_once()
        db.commit.assert_called_once()
        db.refresh.assert_called_once()

    def test_get_by_jti_found(self):
        mock_token = MagicMock()
        db = _chain(_db(), mock_token)
        repo = RefreshTokenRepository(db)
        assert repo.get_by_jti("jti-abc") is mock_token

    def test_get_by_jti_not_found(self):
        repo = RefreshTokenRepository(_chain(_db(), None))
        assert repo.get_by_jti("missing") is None

    def test_revoke_by_jti_sets_revoked(self):
        mock_token = MagicMock()
        mock_token.revoked = False
        db = _chain(_db(), mock_token)
        repo = RefreshTokenRepository(db)
        repo.revoke_by_jti("jti-abc")
        assert mock_token.revoked is True
        db.commit.assert_called_once()

    def test_revoke_by_jti_noop_when_not_found(self):
        db = _chain(_db(), None)
        repo = RefreshTokenRepository(db)
        repo.revoke_by_jti("missing")  # must not raise
        db.commit.assert_not_called()
