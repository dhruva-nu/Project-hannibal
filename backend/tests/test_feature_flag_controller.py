"""Tests for the /feature-flags user evaluation endpoint."""

import pytest
from fastapi.testclient import TestClient

from app.dependencies.auth import require_auth
from app.dependencies.feature_flag import get_feature_flag_service
from app.main import app
from app.services.feature_flag_service import FeatureFlagService

client = TestClient(app, raise_server_exceptions=False)

_USER_PAYLOAD = {"sub": "1", "email": "user@example.com", "role": "student"}
_BAD_PAYLOAD = {"sub": "not-an-int", "email": "user@example.com", "role": "student"}


def _mock_service(mocker, payload=_USER_PAYLOAD, **kwargs):
    mock = mocker.MagicMock(spec=FeatureFlagService)
    for method, value in kwargs.items():
        if isinstance(value, Exception):
            getattr(mock, method).side_effect = value
        else:
            getattr(mock, method).return_value = value
    app.dependency_overrides[get_feature_flag_service] = lambda: mock
    app.dependency_overrides[require_auth] = lambda: payload
    return mock


@pytest.fixture(autouse=True)
def clear_overrides():
    yield
    app.dependency_overrides.clear()


class TestEvaluateFlags:
    def test_returns_200_with_flag_map(self, mocker):
        _mock_service(mocker, evaluate_for_user={"new-ui": True, "beta": False})
        resp = client.get("/api/v1/feature-flags/")
        assert resp.status_code == 200
        assert resp.json() == {"flags": {"new-ui": True, "beta": False}}

    def test_empty_map_returns_200(self, mocker):
        _mock_service(mocker, evaluate_for_user={})
        resp = client.get("/api/v1/feature-flags/")
        assert resp.status_code == 200
        assert resp.json() == {"flags": {}}

    def test_passes_user_id_and_role(self, mocker):
        mock = _mock_service(mocker, evaluate_for_user={})
        client.get("/api/v1/feature-flags/")
        mock.evaluate_for_user.assert_called_once_with(1, "student")

    def test_invalid_payload_returns_401(self, mocker):
        _mock_service(mocker, payload=_BAD_PAYLOAD, evaluate_for_user={})
        resp = client.get("/api/v1/feature-flags/")
        assert resp.status_code == 401

    def test_service_error_returns_500(self, mocker):
        _mock_service(mocker, evaluate_for_user=RuntimeError("db down"))
        resp = client.get("/api/v1/feature-flags/")
        assert resp.status_code == 500
