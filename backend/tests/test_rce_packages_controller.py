"""Tests for /rce/packages search + verify endpoints."""

import pytest
from fastapi.testclient import TestClient

from app.dependencies.rce_packages import get_package_search_service
from app.main import app
from app.schemas.rce_packages import PackageVerifyResponse
from app.services.rce.package_search_service import PackageSearchService

client = TestClient(app, raise_server_exceptions=False)


def _mock_service(mocker, **kwargs):
    mock = mocker.MagicMock(spec=PackageSearchService)
    for method, value in kwargs.items():
        if isinstance(value, Exception):
            getattr(mock, method).side_effect = value
        else:
            getattr(mock, method).return_value = value
    app.dependency_overrides[get_package_search_service] = lambda: mock
    return mock


@pytest.fixture(autouse=True)
def clear_overrides():
    yield
    app.dependency_overrides.clear()


class TestSearch:
    def test_returns_matches(self, mocker):
        _mock_service(mocker, search=["requests", "regex"])
        resp = client.get("/api/v1/rce/packages/search?language=python&q=re")
        assert resp.status_code == 200
        assert resp.json() == ["requests", "regex"]

    def test_empty_result(self, mocker):
        _mock_service(mocker, search=[])
        resp = client.get("/api/v1/rce/packages/search?language=python&q=zzz")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_unsupported_language_returns_404(self, mocker):
        _mock_service(mocker, search=ValueError("Unsupported language: cobol"))
        resp = client.get("/api/v1/rce/packages/search?language=cobol&q=re")
        assert resp.status_code == 404

    def test_missing_query_returns_422(self, mocker):
        _mock_service(mocker, search=[])
        resp = client.get("/api/v1/rce/packages/search?language=python")
        assert resp.status_code == 422

    def test_service_error_returns_500(self, mocker):
        _mock_service(mocker, search=RuntimeError("db down"))
        resp = client.get("/api/v1/rce/packages/search?language=python&q=re")
        assert resp.status_code == 500


class TestVerify:
    def test_existing_package(self, mocker):
        _mock_service(
            mocker,
            verify=PackageVerifyResponse(name="requests", exists=True, in_cache=True),
        )
        resp = client.get("/api/v1/rce/packages/verify?language=python&name=requests")
        assert resp.status_code == 200
        assert resp.json() == {"name": "requests", "exists": True, "in_cache": True}

    def test_missing_package(self, mocker):
        _mock_service(
            mocker,
            verify=PackageVerifyResponse(name="nope123", exists=False, in_cache=False),
        )
        resp = client.get("/api/v1/rce/packages/verify?language=python&name=nope123")
        assert resp.status_code == 200
        assert resp.json()["exists"] is False

    def test_registry_unreachable_returns_null_exists(self, mocker):
        _mock_service(
            mocker,
            verify=PackageVerifyResponse(name="flaky", exists=None, in_cache=False),
        )
        resp = client.get("/api/v1/rce/packages/verify?language=python&name=flaky")
        assert resp.status_code == 200
        assert resp.json()["exists"] is None

    def test_unsupported_language_returns_404(self, mocker):
        _mock_service(mocker, verify=ValueError("Unsupported language: cobol"))
        resp = client.get("/api/v1/rce/packages/verify?language=cobol&name=x")
        assert resp.status_code == 404

    def test_service_error_returns_500(self, mocker):
        _mock_service(mocker, verify=RuntimeError("registry down"))
        resp = client.get("/api/v1/rce/packages/verify?language=python&name=requests")
        assert resp.status_code == 500
