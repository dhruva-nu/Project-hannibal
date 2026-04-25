"""Tests for POST /auth/register, /auth/login, /auth/logout."""
import pytest
from fastapi.testclient import TestClient

from app.dependencies.auth import get_auth_service
from app.main import app
from app.schemas.auth import TokenResponse, UserResponse
from app.services.auth_service import AuthService


# ── helpers ───────────────────────────────────────────────────────────────────

def _make_auth_service(mocker, *, register_result=None, login_result=None, register_raises=None, login_raises=None):
    """Return a mock AuthService wired into the FastAPI DI."""
    mock = mocker.MagicMock(spec=AuthService)

    if register_raises:
        mock.register.side_effect = register_raises
    else:
        mock.register.return_value = register_result

    if login_raises:
        mock.login.side_effect = login_raises
    else:
        mock.login.return_value = login_result

    app.dependency_overrides[get_auth_service] = lambda: mock
    return mock


@pytest.fixture(autouse=True)
def clear_overrides():
    yield
    app.dependency_overrides.clear()


client = TestClient(app, raise_server_exceptions=False)

_USER = UserResponse(id=1, email="user@example.com")
_TOKEN = TokenResponse(access_token="test.jwt.token")


# ── register ──────────────────────────────────────────────────────────────────

class TestRegister:
    def test_success_returns_201(self, mocker):
        _make_auth_service(mocker, register_result=_USER)
        resp = client.post("/api/v1/auth/register", json={"email": "user@example.com", "password": "strongpass"})
        assert resp.status_code == 201
        assert resp.json() == {"id": 1, "email": "user@example.com"}

    def test_duplicate_email_returns_409(self, mocker):
        _make_auth_service(mocker, register_raises=ValueError("Email already registered"))
        resp = client.post("/api/v1/auth/register", json={"email": "user@example.com", "password": "strongpass"})
        assert resp.status_code == 409
        assert "already registered" in resp.json()["detail"]

    def test_short_password_returns_422(self, mocker):
        _make_auth_service(mocker, register_result=_USER)
        resp = client.post("/api/v1/auth/register", json={"email": "user@example.com", "password": "short"})
        assert resp.status_code == 422

    def test_invalid_email_returns_422(self, mocker):
        _make_auth_service(mocker, register_result=_USER)
        resp = client.post("/api/v1/auth/register", json={"email": "not-an-email", "password": "strongpass"})
        assert resp.status_code == 422

    def test_missing_fields_returns_422(self, mocker):
        _make_auth_service(mocker, register_result=_USER)
        resp = client.post("/api/v1/auth/register", json={})
        assert resp.status_code == 422


# ── login ─────────────────────────────────────────────────────────────────────

class TestLogin:
    def test_success_returns_token(self, mocker):
        _make_auth_service(mocker, login_result=_TOKEN)
        resp = client.post("/api/v1/auth/login", json={"email": "user@example.com", "password": "strongpass"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["access_token"] == "test.jwt.token"
        assert body["token_type"] == "bearer"

    def test_wrong_password_returns_401(self, mocker):
        _make_auth_service(mocker, login_raises=ValueError("Invalid credentials"))
        resp = client.post("/api/v1/auth/login", json={"email": "user@example.com", "password": "wrongpass"})
        assert resp.status_code == 401
        assert resp.json()["detail"] == "Invalid email or password"

    def test_unknown_email_returns_401(self, mocker):
        _make_auth_service(mocker, login_raises=ValueError("Invalid credentials"))
        resp = client.post("/api/v1/auth/login", json={"email": "ghost@example.com", "password": "strongpass"})
        assert resp.status_code == 401

    def test_invalid_email_format_returns_422(self, mocker):
        _make_auth_service(mocker, login_result=_TOKEN)
        resp = client.post("/api/v1/auth/login", json={"email": "bad", "password": "strongpass"})
        assert resp.status_code == 422


# ── logout ────────────────────────────────────────────────────────────────────

class TestLogout:
    def test_valid_token_returns_204(self, mocker):
        svc = _make_auth_service(mocker)
        svc.verify_token.return_value = {"sub": "1", "email": "user@example.com"}
        resp = client.post(
            "/api/v1/auth/logout",
            headers={"Authorization": "Bearer valid.jwt.token"},
        )
        assert resp.status_code == 204

    def test_no_token_returns_401(self, mocker):
        _make_auth_service(mocker)
        resp = client.post("/api/v1/auth/logout")
        assert resp.status_code == 401

    def test_invalid_token_returns_401(self, mocker):
        svc = _make_auth_service(mocker)
        svc.verify_token.side_effect = ValueError("Invalid or expired token")
        resp = client.post(
            "/api/v1/auth/logout",
            headers={"Authorization": "Bearer bad.token"},
        )
        assert resp.status_code == 401
