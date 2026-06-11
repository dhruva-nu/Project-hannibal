"""Tests for /user-preferences endpoints."""

from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from app.dependencies.auth import require_admin, require_auth
from app.dependencies.user_preference import get_user_preference_service
from app.main import app
from app.services.user_preference_service import UserPreferenceService

client = TestClient(app, raise_server_exceptions=False)

_USER_PAYLOAD = {"sub": "1", "email": "user@example.com", "role": "student"}
_ADMIN_PAYLOAD = {"sub": "1", "email": "admin@example.com", "role": "admin"}
_BAD_PAYLOAD = {"sub": "not-an-int", "email": "user@example.com", "role": "student"}


def _mock_service(mocker, **kwargs):
    mock = mocker.MagicMock(spec=UserPreferenceService)
    for method, value in kwargs.items():
        if isinstance(value, Exception):
            if hasattr(getattr(mock, method), "side_effect"):
                getattr(mock, method).side_effect = value
            else:
                attr = AsyncMock(side_effect=value)
                setattr(mock, method, attr)
        else:
            attr = (
                AsyncMock(return_value=value)
                if "preference" in method
                else mocker.MagicMock(return_value=value)
            )
            setattr(mock, method, attr)
    app.dependency_overrides[get_user_preference_service] = lambda: mock
    app.dependency_overrides[require_auth] = lambda: _USER_PAYLOAD
    return mock


@pytest.fixture(autouse=True)
def clear_overrides():
    yield
    app.dependency_overrides.clear()


class TestGetPreferences:
    def test_returns_200_with_preferences(self, mocker):
        _mock_service(mocker, get_preferences={"lang": "python"})
        resp = client.get("/api/v1/user-preferences/")
        assert resp.status_code == 200
        assert resp.json() == {"preferences": {"lang": "python"}}

    def test_returns_200_with_empty_dict_when_no_prefs(self, mocker):
        _mock_service(mocker, get_preferences={})
        resp = client.get("/api/v1/user-preferences/")
        assert resp.status_code == 200
        assert resp.json() == {"preferences": {}}

    def test_unauthenticated_returns_401(self):
        resp = client.get("/api/v1/user-preferences/")
        assert resp.status_code == 401

    def test_invalid_payload_returns_401(self, mocker):
        _mock_service(mocker, get_preferences={})
        app.dependency_overrides[require_auth] = lambda: _BAD_PAYLOAD
        resp = client.get("/api/v1/user-preferences/")
        assert resp.status_code == 401

    def test_unexpected_error_returns_500(self, mocker):
        _mock_service(mocker, get_preferences=RuntimeError("mongo down"))
        resp = client.get("/api/v1/user-preferences/")
        assert resp.status_code == 500


class TestUpsertPreference:
    def test_returns_200_with_updated_preferences(self, mocker):
        _mock_service(mocker, upsert_preference={"lang": "python"})
        resp = client.put(
            "/api/v1/user-preferences/", json={"key": "lang", "value": "python"}
        )
        assert resp.status_code == 200
        assert resp.json() == {"preferences": {"lang": "python"}}

    def test_unknown_key_returns_422(self, mocker):
        _mock_service(
            mocker, upsert_preference=ValueError("Unknown preference key: 'bad'.")
        )
        resp = client.put(
            "/api/v1/user-preferences/", json={"key": "bad", "value": "x"}
        )
        assert resp.status_code == 422
        assert "Unknown preference key" in resp.json()["detail"]

    def test_user_not_found_returns_422(self, mocker):
        _mock_service(mocker, upsert_preference=ValueError("User not found."))
        resp = client.put(
            "/api/v1/user-preferences/", json={"key": "lang", "value": "python"}
        )
        assert resp.status_code == 422

    def test_unauthenticated_returns_401(self):
        resp = client.put(
            "/api/v1/user-preferences/", json={"key": "lang", "value": "python"}
        )
        assert resp.status_code == 401

    def test_unexpected_error_returns_500(self, mocker):
        _mock_service(mocker, upsert_preference=RuntimeError("mongo down"))
        resp = client.put(
            "/api/v1/user-preferences/", json={"key": "lang", "value": "python"}
        )
        assert resp.status_code == 500


class TestListKeys:
    def test_returns_200_with_keys(self, mocker):
        from app.models.preference_key_model import PreferenceKey

        key = PreferenceKey()
        key.id = 1
        key.key = "lang"
        key.description = "Programming language"
        mock = _mock_service(mocker)
        mock.list_keys.return_value = [key]
        resp = client.get("/api/v1/user-preferences/keys")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["key"] == "lang"

    def test_unexpected_error_returns_500(self, mocker):
        mock = _mock_service(mocker)
        mock.list_keys.side_effect = RuntimeError("db down")
        resp = client.get("/api/v1/user-preferences/keys")
        assert resp.status_code == 500


class TestCreateKey:
    def test_admin_can_create_key(self, mocker):
        from app.models.preference_key_model import PreferenceKey

        key = PreferenceKey()
        key.id = 7
        key.key = "cloud"
        key.description = "Cloud provider"
        mock = _mock_service(mocker)
        mock.create_key.return_value = key
        app.dependency_overrides[require_admin] = lambda: _ADMIN_PAYLOAD
        resp = client.post(
            "/api/v1/user-preferences/keys",
            json={"key": "cloud", "value": "Cloud provider"},
        )
        assert resp.status_code == 201
        assert resp.json()["key"] == "cloud"

    def test_duplicate_key_returns_409(self, mocker):
        mock = _mock_service(mocker)
        mock.create_key.side_effect = ValueError("already exists")
        app.dependency_overrides[require_admin] = lambda: _ADMIN_PAYLOAD
        resp = client.post(
            "/api/v1/user-preferences/keys",
            json={"key": "lang", "value": "desc"},
        )
        assert resp.status_code == 409

    def test_non_admin_returns_403(self, mocker):
        _mock_service(mocker)
        resp = client.post(
            "/api/v1/user-preferences/keys",
            json={"key": "cloud", "value": "Cloud provider"},
        )
        assert resp.status_code == 403

    def test_unexpected_error_returns_500(self, mocker):
        mock = _mock_service(mocker)
        mock.create_key.side_effect = RuntimeError("db exploded")
        app.dependency_overrides[require_admin] = lambda: _ADMIN_PAYLOAD
        resp = client.post(
            "/api/v1/user-preferences/keys",
            json={"key": "lang", "value": "desc"},
        )
        assert resp.status_code == 500
