from datetime import datetime, timezone

from app.repositories.refresh_token_repository import RefreshTokenRepository
from tests.helpers import _chain, _db


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
        mock_token = _db()
        db = _chain(_db(), mock_token)
        repo = RefreshTokenRepository(db)
        assert repo.get_by_jti("jti-abc") is mock_token

    def test_get_by_jti_not_found(self):
        repo = RefreshTokenRepository(_chain(_db(), None))
        assert repo.get_by_jti("missing") is None

    def test_revoke_by_jti_sets_revoked(self):
        from unittest.mock import MagicMock

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
        repo.revoke_by_jti("missing")
        db.commit.assert_not_called()
