"""Tests for /tags CRUD endpoints."""
import pytest
from fastapi.testclient import TestClient

from app.dependencies.tags import get_tags_service
from app.main import app
from app.schemas.tags import TagResponse
from app.services.tags_service import TagsService

client = TestClient(app, raise_server_exceptions=False)

_TAG = TagResponse(id=1, name="python", description="Python lang")
_TAG2 = TagResponse(id=2, name="js", description="JavaScript")


def _mock_service(mocker, **kwargs):
    mock = mocker.MagicMock(spec=TagsService)
    for method, value in kwargs.items():
        if isinstance(value, Exception):
            getattr(mock, method).side_effect = value
        else:
            getattr(mock, method).return_value = value
    app.dependency_overrides[get_tags_service] = lambda: mock
    return mock


@pytest.fixture(autouse=True)
def clear_overrides():
    yield
    app.dependency_overrides.clear()


class TestListTags:
    def test_returns_200_with_list(self, mocker):
        _mock_service(mocker, list_tags=[_TAG, _TAG2])
        resp = client.get("/api/v1/tags/")
        assert resp.status_code == 200
        assert len(resp.json()) == 2

    def test_empty_list_returns_200(self, mocker):
        _mock_service(mocker, list_tags=[])
        resp = client.get("/api/v1/tags/")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_service_error_returns_500(self, mocker):
        _mock_service(mocker, list_tags=RuntimeError("db down"))
        resp = client.get("/api/v1/tags/")
        assert resp.status_code == 500


class TestGetTag:
    def test_found_returns_200(self, mocker):
        _mock_service(mocker, get_tag=_TAG)
        resp = client.get("/api/v1/tags/1")
        assert resp.status_code == 200
        assert resp.json()["name"] == "python"

    def test_not_found_returns_404(self, mocker):
        _mock_service(mocker, get_tag=ValueError("Tag 99 not found"))
        resp = client.get("/api/v1/tags/99")
        assert resp.status_code == 404

    def test_service_error_returns_500(self, mocker):
        _mock_service(mocker, get_tag=RuntimeError("db down"))
        resp = client.get("/api/v1/tags/1")
        assert resp.status_code == 500


class TestCreateTag:
    def test_success_returns_201(self, mocker):
        _mock_service(mocker, create_tag=_TAG)
        resp = client.post("/api/v1/tags/", json={"name": "python", "description": "Python lang"})
        assert resp.status_code == 201
        assert resp.json()["id"] == 1

    def test_missing_name_returns_422(self, mocker):
        _mock_service(mocker)
        resp = client.post("/api/v1/tags/", json={"description": "no name"})
        assert resp.status_code == 422

    def test_missing_description_returns_422(self, mocker):
        _mock_service(mocker)
        resp = client.post("/api/v1/tags/", json={"name": "python"})
        assert resp.status_code == 422

    def test_service_error_returns_500(self, mocker):
        _mock_service(mocker, create_tag=RuntimeError("db down"))
        resp = client.post("/api/v1/tags/", json={"name": "python", "description": "Python lang"})
        assert resp.status_code == 500


class TestUpdateTag:
    def test_success_returns_200(self, mocker):
        updated = TagResponse(id=1, name="rust", description="Rust lang")
        _mock_service(mocker, update_tag=updated)
        resp = client.patch("/api/v1/tags/1", json={"name": "rust"})
        assert resp.status_code == 200
        assert resp.json()["name"] == "rust"

    def test_not_found_returns_404(self, mocker):
        _mock_service(mocker, update_tag=ValueError("Tag 99 not found"))
        resp = client.patch("/api/v1/tags/99", json={"name": "x"})
        assert resp.status_code == 404

    def test_partial_update_accepted(self, mocker):
        _mock_service(mocker, update_tag=_TAG)
        resp = client.patch("/api/v1/tags/1", json={})
        assert resp.status_code == 200

    def test_service_error_returns_500(self, mocker):
        _mock_service(mocker, update_tag=RuntimeError("db down"))
        resp = client.patch("/api/v1/tags/1", json={"name": "x"})
        assert resp.status_code == 500


class TestDeleteTag:
    def test_success_returns_204(self, mocker):
        _mock_service(mocker, delete_tag=None)
        resp = client.delete("/api/v1/tags/1")
        assert resp.status_code == 204

    def test_not_found_returns_404(self, mocker):
        _mock_service(mocker, delete_tag=ValueError("Tag 99 not found"))
        resp = client.delete("/api/v1/tags/99")
        assert resp.status_code == 404

    def test_service_error_returns_500(self, mocker):
        _mock_service(mocker, delete_tag=RuntimeError("db down"))
        resp = client.delete("/api/v1/tags/1")
        assert resp.status_code == 500
