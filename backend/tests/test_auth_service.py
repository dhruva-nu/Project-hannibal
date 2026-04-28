"""Unit tests for AuthService — repositories and httpx are fully mocked."""
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import bcrypt
import pytest
from jose import jwt

from app.core.config import settings
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.services.auth_service import AuthService


# ── Helpers ────────────────────────────────────────────────────────────────

def _make_user(
    id: int = 1,
    email: str = "user@example.com",
    password: str = "secret",
    provider: str = "local",
    oauth_id: str | None = None,
) -> User:
    user = User()
    user.id = id
    user.email = email
    user.hashed_password = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode() if password else None
    user.provider = provider
    user.oauth_id = oauth_id
    user.created_at = datetime.now(timezone.utc)
    return user


def _make_refresh_token(jti: str, revoked: bool = False, expired: bool = False) -> RefreshToken:
    rt = RefreshToken()
    rt.jti = jti
    rt.revoked = revoked
    rt.expires_at = (
        datetime.now(timezone.utc) - timedelta(hours=1)
        if expired
        else datetime.now(timezone.utc) + timedelta(days=7)
    )
    return rt


def _make_service(user_repo=None, refresh_repo=None) -> AuthService:
    return AuthService(
        repository=user_repo or MagicMock(),
        refresh_repository=refresh_repo or MagicMock(),
    )


def _valid_refresh_token(user_id: int = 1, email: str = "user@example.com") -> tuple[str, str]:
    """Return a (token, jti) pair signed with the real secret."""
    import uuid
    jti = str(uuid.uuid4())
    payload = {
        "sub": str(user_id),
        "email": email,
        "jti": jti,
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
    }
    token = jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)
    return token, jti


# ── Register ───────────────────────────────────────────────────────────────

class TestRegisterService:
    def test_success_returns_user_response(self):
        user = _make_user()
        repo = MagicMock()
        repo.get_by_email.return_value = None
        repo.create.return_value = user
        svc = _make_service(user_repo=repo)

        result = svc.register("user@example.com", "secret")

        assert result.email == "user@example.com"
        repo.create.assert_called_once()

    def test_duplicate_email_raises(self):
        repo = MagicMock()
        repo.get_by_email.return_value = _make_user()
        svc = _make_service(user_repo=repo)

        with pytest.raises(ValueError, match="already registered"):
            svc.register("user@example.com", "secret")


# ── Login ──────────────────────────────────────────────────────────────────

class TestLoginService:
    def test_success_returns_tokens_and_user(self):
        user = _make_user(password="secret")
        repo = MagicMock()
        repo.get_by_email.return_value = user
        refresh_repo = MagicMock()
        refresh_repo.create.return_value = MagicMock()
        svc = _make_service(user_repo=repo, refresh_repo=refresh_repo)

        access, refresh, resp = svc.login("user@example.com", "secret")

        assert resp.email == "user@example.com"
        assert access
        assert refresh
        refresh_repo.create.assert_called_once()

    def test_unknown_email_raises(self):
        repo = MagicMock()
        repo.get_by_email.return_value = None
        svc = _make_service(user_repo=repo)

        with pytest.raises(ValueError, match="Invalid credentials"):
            svc.login("nobody@example.com", "secret")

    def test_wrong_password_raises(self):
        repo = MagicMock()
        repo.get_by_email.return_value = _make_user(password="correct")
        svc = _make_service(user_repo=repo)

        with pytest.raises(ValueError, match="Invalid credentials"):
            svc.login("user@example.com", "wrong")

    def test_oauth_user_without_password_raises(self):
        user = _make_user()
        user.hashed_password = None
        repo = MagicMock()
        repo.get_by_email.return_value = user
        svc = _make_service(user_repo=repo)

        with pytest.raises(ValueError, match="Invalid credentials"):
            svc.login("user@example.com", "any")


# ── Refresh ────────────────────────────────────────────────────────────────

class TestRefreshService:
    def test_success_returns_new_access_token(self):
        token, jti = _valid_refresh_token()
        rt = _make_refresh_token(jti)
        refresh_repo = MagicMock()
        refresh_repo.get_by_jti.return_value = rt
        svc = _make_service(refresh_repo=refresh_repo)

        new_access = svc.refresh(token)

        assert new_access
        payload = jwt.decode(new_access, settings.secret_key, algorithms=[settings.jwt_algorithm])
        assert payload["email"] == "user@example.com"

    def test_invalid_token_raises(self):
        svc = _make_service()
        with pytest.raises(ValueError, match="Invalid or expired"):
            svc.refresh("not-a-token")

    def test_revoked_token_raises(self):
        token, jti = _valid_refresh_token()
        rt = _make_refresh_token(jti, revoked=True)
        refresh_repo = MagicMock()
        refresh_repo.get_by_jti.return_value = rt
        svc = _make_service(refresh_repo=refresh_repo)

        with pytest.raises(ValueError, match="Invalid or expired"):
            svc.refresh(token)

    def test_unknown_jti_raises(self):
        token, _ = _valid_refresh_token()
        refresh_repo = MagicMock()
        refresh_repo.get_by_jti.return_value = None
        svc = _make_service(refresh_repo=refresh_repo)

        with pytest.raises(ValueError, match="Invalid or expired"):
            svc.refresh(token)

    def test_expired_record_raises(self):
        token, jti = _valid_refresh_token()
        rt = _make_refresh_token(jti, expired=True)
        refresh_repo = MagicMock()
        refresh_repo.get_by_jti.return_value = rt
        svc = _make_service(refresh_repo=refresh_repo)

        with pytest.raises(ValueError, match="Invalid or expired"):
            svc.refresh(token)


# ── Logout ─────────────────────────────────────────────────────────────────

class TestLogoutService:
    def test_success_revokes_token(self):
        token, jti = _valid_refresh_token()
        refresh_repo = MagicMock()
        svc = _make_service(refresh_repo=refresh_repo)

        svc.logout(token)

        refresh_repo.revoke_by_jti.assert_called_once_with(jti)

    def test_invalid_token_does_not_raise(self):
        svc = _make_service()
        svc.logout("garbage")  # must not raise


# ── verify_token ───────────────────────────────────────────────────────────

class TestVerifyTokenService:
    def test_valid_token_returns_payload(self):
        svc = _make_service()
        token = svc._create_access_token({"sub": "1", "email": "u@x.com"})
        payload = svc.verify_token(token)
        assert payload["email"] == "u@x.com"

    def test_invalid_token_raises(self):
        svc = _make_service()
        with pytest.raises(ValueError, match="Invalid or expired"):
            svc.verify_token("bad-token")


# ── OAuth state ────────────────────────────────────────────────────────────

class TestOAuthState:
    def test_generate_returns_dotted_string(self):
        svc = _make_service()
        state = svc.generate_oauth_state()
        assert "." in state

    def test_verify_valid_state(self):
        svc = _make_service()
        state = svc.generate_oauth_state()
        assert svc.verify_oauth_state(state) is True

    def test_verify_tampered_state(self):
        svc = _make_service()
        state = svc.generate_oauth_state()
        tampered = state[:-3] + "XXX"
        assert svc.verify_oauth_state(tampered) is False

    def test_verify_bad_format(self):
        svc = _make_service()
        assert svc.verify_oauth_state("nodot") is False


# ── get_google_auth_url ────────────────────────────────────────────────────

class TestGoogleAuthUrl:
    def test_url_contains_client_id(self):
        svc = _make_service()
        url = svc.get_google_auth_url("mystate")
        assert "client_id=" in url
        assert "mystate" in url
        assert url.startswith("https://accounts.google.com")


# ── handle_google_callback ─────────────────────────────────────────────────

class TestGoogleCallback:
    def test_success_creates_user_and_returns_tokens(self):
        user = _make_user(provider="google", oauth_id="gid123", password="")
        user.hashed_password = None
        repo = MagicMock()
        repo.get_or_create_oauth_user.return_value = user
        refresh_repo = MagicMock()
        refresh_repo.create.return_value = MagicMock()
        svc = _make_service(user_repo=repo, refresh_repo=refresh_repo)

        mock_token_resp = MagicMock()
        mock_token_resp.json.return_value = {"access_token": "google-token"}
        mock_token_resp.raise_for_status = MagicMock()

        mock_info_resp = MagicMock()
        mock_info_resp.json.return_value = {"email": "user@example.com", "id": "gid123"}
        mock_info_resp.raise_for_status = MagicMock()

        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.post.return_value = mock_token_resp
        mock_client.get.return_value = mock_info_resp

        with patch("app.services.auth_service.httpx.Client", return_value=mock_client):
            access, refresh, resp = svc.handle_google_callback("auth-code")

        assert resp.email == "user@example.com"
        assert access
        assert refresh
