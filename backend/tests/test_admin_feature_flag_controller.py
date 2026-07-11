"""Tests for the /admin/feature-flags CRUD endpoints."""

from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from app.dependencies.auth import require_admin
from app.dependencies.feature_flag import get_feature_flag_service
from app.main import app
from app.schemas.feature_flag import FeatureFlagResponse
from app.services.feature_flag_service import FeatureFlagService

client = TestClient(app, raise_server_exceptions=False)

_ADMIN_PAYLOAD = {"sub": "1", "email": "admin@example.com", "role": "admin"}

_FLAG = FeatureFlagResponse(
    id=1,
    key="new-ui",
    description="new sidebar",
    enabled=True,
    rollout_percentage=25,
    target_roles=["admin"],
    created_at=datetime(2026, 7, 1, tzinfo=UTC),
    updated_at=datetime(2026, 7, 1, tzinfo=UTC),
)


def _mock_service(mocker, **kwargs):
    mock = mocker.MagicMock(spec=FeatureFlagService)
    for method, value in kwargs.items():
        if isinstance(value, Exception):
            getattr(mock, method).side_effect = value
        else:
            getattr(mock, method).return_value = value
    app.dependency_overrides[get_feature_flag_service] = lambda: mock
    app.dependency_overrides[require_admin] = lambda: _ADMIN_PAYLOAD
    return mock


@pytest.fixture(autouse=True)
def clear_overrides():
    yield
    app.dependency_overrides.clear()


class TestListFlags:
    def test_returns_200(self, mocker):
        _mock_service(mocker, list_flags=[_FLAG])
        resp = client.get("/api/v1/admin/feature-flags/")
        assert resp.status_code == 200
        assert len(resp.json()) == 1

    def test_service_error_returns_500(self, mocker):
        _mock_service(mocker, list_flags=RuntimeError("db down"))
        resp = client.get("/api/v1/admin/feature-flags/")
        assert resp.status_code == 500


class TestGetFlag:
    def test_found_returns_200(self, mocker):
        _mock_service(mocker, get_flag=_FLAG)
        resp = client.get("/api/v1/admin/feature-flags/new-ui")
        assert resp.status_code == 200
        assert resp.json()["key"] == "new-ui"

    def test_not_found_returns_404(self, mocker):
        _mock_service(mocker, get_flag=ValueError("not found"))
        resp = client.get("/api/v1/admin/feature-flags/missing")
        assert resp.status_code == 404

    def test_service_error_returns_500(self, mocker):
        _mock_service(mocker, get_flag=RuntimeError("db down"))
        resp = client.get("/api/v1/admin/feature-flags/new-ui")
        assert resp.status_code == 500


class TestCreateFlag:
    def test_success_returns_201(self, mocker):
        _mock_service(mocker, create_flag=_FLAG)
        resp = client.post(
            "/api/v1/admin/feature-flags/",
            json={"key": "new-ui", "rollout_percentage": 25},
        )
        assert resp.status_code == 201
        assert resp.json()["key"] == "new-ui"

    def test_missing_key_returns_422(self, mocker):
        _mock_service(mocker)
        resp = client.post("/api/v1/admin/feature-flags/", json={"description": "x"})
        assert resp.status_code == 422

    def test_percentage_out_of_range_returns_422(self, mocker):
        _mock_service(mocker)
        resp = client.post(
            "/api/v1/admin/feature-flags/",
            json={"key": "new-ui", "rollout_percentage": 200},
        )
        assert resp.status_code == 422

    def test_duplicate_returns_409(self, mocker):
        _mock_service(mocker, create_flag=ValueError("already exists"))
        resp = client.post("/api/v1/admin/feature-flags/", json={"key": "new-ui"})
        assert resp.status_code == 409

    def test_service_error_returns_500(self, mocker):
        _mock_service(mocker, create_flag=RuntimeError("db down"))
        resp = client.post("/api/v1/admin/feature-flags/", json={"key": "new-ui"})
        assert resp.status_code == 500


class TestUpdateFlag:
    def test_success_returns_200(self, mocker):
        _mock_service(mocker, update_flag=_FLAG)
        resp = client.patch(
            "/api/v1/admin/feature-flags/new-ui", json={"enabled": False}
        )
        assert resp.status_code == 200

    def test_not_found_returns_404(self, mocker):
        _mock_service(mocker, update_flag=ValueError("not found"))
        resp = client.patch(
            "/api/v1/admin/feature-flags/missing", json={"enabled": False}
        )
        assert resp.status_code == 404

    def test_partial_update_accepted(self, mocker):
        _mock_service(mocker, update_flag=_FLAG)
        resp = client.patch("/api/v1/admin/feature-flags/new-ui", json={})
        assert resp.status_code == 200

    def test_service_error_returns_500(self, mocker):
        _mock_service(mocker, update_flag=RuntimeError("db down"))
        resp = client.patch(
            "/api/v1/admin/feature-flags/new-ui", json={"enabled": False}
        )
        assert resp.status_code == 500


class TestDeleteFlag:
    def test_success_returns_204(self, mocker):
        _mock_service(mocker, delete_flag=None)
        resp = client.delete("/api/v1/admin/feature-flags/new-ui")
        assert resp.status_code == 204

    def test_not_found_returns_404(self, mocker):
        _mock_service(mocker, delete_flag=ValueError("not found"))
        resp = client.delete("/api/v1/admin/feature-flags/missing")
        assert resp.status_code == 404

    def test_service_error_returns_500(self, mocker):
        _mock_service(mocker, delete_flag=RuntimeError("db down"))
        resp = client.delete("/api/v1/admin/feature-flags/new-ui")
        assert resp.status_code == 500
