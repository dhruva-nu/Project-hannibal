"""Integration tests for /api/v1/auth.

Exercises controller → AuthService → UserRepository/RefreshTokenRepository
with a mock DB session. Uses real bcrypt hashing and JWT operations.
"""

import uuid
from datetime import UTC, datetime, timedelta

import bcrypt
from jose import jwt

from app.core.config import settings
from app.models.refresh_token import RefreshToken
from app.models.user import User

_EMAIL = "user@example.com"
_PASSWORD = "strongpass"
_HASHED = bcrypt.hashpw(_PASSWORD.encode(), bcrypt.gensalt()).decode()


def _user(**overrides) -> User:
    defaults = dict(
        id=1,
        email=_EMAIL,
        hashed_password=_HASHED,
        provider="local",
        oauth_id=None,
        role="student",
    )
    return User(**{**defaults, **overrides})


def _make_refresh_token(jti: str) -> RefreshToken:
    return RefreshToken(
        id=1,
        user_id=1,
        jti=jti,
        expires_at=datetime.now(UTC) + timedelta(days=7),
        revoked=False,
    )


def _encode_refresh_token(jti: str) -> str:
    return jwt.encode(
        {
            "sub": "1",
            "email": _EMAIL,
            "role": "student",
            "jti": jti,
            "exp": datetime.now(UTC) + timedelta(days=7),
        },
        settings.secret_key,
        algorithm=settings.jwt_algorithm,
    )


class TestRegisterIntegration:
    def test_new_user_returns_201_with_user_data(self, client, mock_db):
        mock_db.query.return_value.filter.return_value.first.return_value = None
        mock_db.refresh.side_effect = lambda obj: setattr(obj, "id", 1)
        resp = client.post(
            "/api/v1/auth/register",
            json={"email": _EMAIL, "password": _PASSWORD},
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["email"] == _EMAIL
        assert body["provider"] == "local"
        assert body["id"] == 1

    def test_duplicate_email_returns_409(self, client, mock_db):
        mock_db.query.return_value.filter.return_value.first.return_value = _user()
        resp = client.post(
            "/api/v1/auth/register",
            json={"email": _EMAIL, "password": _PASSWORD},
        )
        assert resp.status_code == 409
        assert "already registered" in resp.json()["detail"]

    def test_new_user_password_is_hashed_in_db(self, client, mock_db):
        mock_db.query.return_value.filter.return_value.first.return_value = None
        mock_db.refresh.side_effect = lambda obj: setattr(obj, "id", 1)
        client.post(
            "/api/v1/auth/register",
            json={"email": _EMAIL, "password": _PASSWORD},
        )
        added_user: User = mock_db.add.call_args[0][0]
        assert added_user.hashed_password != _PASSWORD
        assert bcrypt.checkpw(_PASSWORD.encode(), added_user.hashed_password.encode())


class TestLoginIntegration:
    def test_valid_credentials_return_200_and_cookies(self, client, mock_db):
        mock_db.query.return_value.filter.return_value.first.return_value = _user()
        resp = client.post(
            "/api/v1/auth/login",
            json={"email": _EMAIL, "password": _PASSWORD},
        )
        assert resp.status_code == 200
        assert resp.json()["email"] == _EMAIL
        assert "access_token" in resp.cookies
        assert "refresh_token" in resp.cookies

    def test_wrong_password_returns_401(self, client, mock_db):
        mock_db.query.return_value.filter.return_value.first.return_value = _user()
        resp = client.post(
            "/api/v1/auth/login",
            json={"email": _EMAIL, "password": "wrongpass"},
        )
        assert resp.status_code == 401

    def test_unknown_email_returns_401(self, client, mock_db):
        mock_db.query.return_value.filter.return_value.first.return_value = None
        resp = client.post(
            "/api/v1/auth/login",
            json={"email": "ghost@example.com", "password": _PASSWORD},
        )
        assert resp.status_code == 401

    def test_access_token_contains_correct_claims(self, client, mock_db):
        mock_db.query.return_value.filter.return_value.first.return_value = _user()
        resp = client.post(
            "/api/v1/auth/login",
            json={"email": _EMAIL, "password": _PASSWORD},
        )
        assert resp.status_code == 200
        token = resp.cookies["access_token"]
        payload = jwt.decode(
            token, settings.secret_key, algorithms=[settings.jwt_algorithm]
        )
        assert payload["email"] == _EMAIL
        assert payload["sub"] == "1"


class TestLogoutIntegration:
    def test_with_valid_refresh_token_revokes_and_clears_cookies(self, client, mock_db):
        jti = str(uuid.uuid4())
        rt = _encode_refresh_token(jti)
        token_record = _make_refresh_token(jti)
        mock_db.query.return_value.filter.return_value.first.return_value = token_record

        resp = client.post("/api/v1/auth/logout", cookies={"refresh_token": rt})

        assert resp.status_code == 204
        assert token_record.revoked is True
        mock_db.commit.assert_called()

    def test_no_cookie_still_returns_204(self, client, mock_db):
        resp = client.post("/api/v1/auth/logout")
        assert resp.status_code == 204

    def test_invalid_refresh_token_still_returns_204(self, client, mock_db):
        resp = client.post(
            "/api/v1/auth/logout",
            cookies={"refresh_token": "invalid.token.value"},
        )
        assert resp.status_code == 204


class TestRefreshIntegration:
    def test_valid_refresh_token_issues_new_access_token(self, client, mock_db):
        jti = str(uuid.uuid4())
        rt = _encode_refresh_token(jti)
        mock_db.query.return_value.filter.return_value.first.return_value = (
            _make_refresh_token(jti)
        )

        resp = client.post("/api/v1/auth/refresh", cookies={"refresh_token": rt})

        assert resp.status_code == 200
        assert "access_token" in resp.cookies
        new_token = resp.cookies["access_token"]
        payload = jwt.decode(
            new_token, settings.secret_key, algorithms=[settings.jwt_algorithm]
        )
        assert payload["email"] == _EMAIL

    def test_revoked_token_returns_401(self, client, mock_db):
        jti = str(uuid.uuid4())
        rt = _encode_refresh_token(jti)
        revoked = _make_refresh_token(jti)
        revoked.revoked = True
        mock_db.query.return_value.filter.return_value.first.return_value = revoked

        resp = client.post("/api/v1/auth/refresh", cookies={"refresh_token": rt})

        assert resp.status_code == 401

    def test_expired_token_returns_401(self, client, mock_db):
        expired_rt = jwt.encode(
            {
                "sub": "1",
                "email": _EMAIL,
                "role": "student",
                "jti": "some-jti",
                "exp": datetime.now(UTC) - timedelta(days=1),
            },
            settings.secret_key,
            algorithm=settings.jwt_algorithm,
        )
        resp = client.post(
            "/api/v1/auth/refresh", cookies={"refresh_token": expired_rt}
        )
        assert resp.status_code == 401

    def test_missing_cookie_returns_401(self, client, mock_db):
        resp = client.post("/api/v1/auth/refresh")
        assert resp.status_code == 401

    def test_jti_not_in_db_returns_401(self, client, mock_db):
        jti = str(uuid.uuid4())
        rt = _encode_refresh_token(jti)
        mock_db.query.return_value.filter.return_value.first.return_value = None

        resp = client.post("/api/v1/auth/refresh", cookies={"refresh_token": rt})

        assert resp.status_code == 401


class TestMeIntegration:
    def _access_token(self) -> str:
        return jwt.encode(
            {
                "sub": "1",
                "email": _EMAIL,
                "role": "student",
                "exp": datetime.now(UTC) + timedelta(minutes=15),
            },
            settings.secret_key,
            algorithm=settings.jwt_algorithm,
        )

    def test_valid_token_returns_user(self, client, mock_db):
        mock_db.query.return_value.filter.return_value.first.return_value = _user()
        resp = client.get(
            "/api/v1/auth/me", cookies={"access_token": self._access_token()}
        )
        assert resp.status_code == 200
        assert resp.json()["email"] == _EMAIL

    def test_missing_token_returns_401(self, client, mock_db):
        resp = client.get("/api/v1/auth/me")
        assert resp.status_code == 401

    def test_user_not_in_db_returns_401(self, client, mock_db):
        mock_db.query.return_value.filter.return_value.first.return_value = None
        resp = client.get(
            "/api/v1/auth/me", cookies={"access_token": self._access_token()}
        )
        assert resp.status_code == 401


class TestTokenEndpointIntegration:
    def test_valid_credentials_return_bearer_token(self, client, mock_db):
        mock_db.query.return_value.filter.return_value.first.return_value = _user()
        resp = client.post(
            "/api/v1/auth/token",
            data={"username": _EMAIL, "password": _PASSWORD},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert "access_token" in body
        assert body["token_type"] == "bearer"

    def test_wrong_credentials_return_401(self, client, mock_db):
        mock_db.query.return_value.filter.return_value.first.return_value = None
        resp = client.post(
            "/api/v1/auth/token",
            data={"username": _EMAIL, "password": "wrong"},
        )
        assert resp.status_code == 401
