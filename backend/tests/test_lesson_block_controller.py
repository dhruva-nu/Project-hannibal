"""Tests for /lesson-blocks CRUD endpoints."""

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from app.dependencies.lesson_block import get_lesson_block_service
from app.main import app
from app.schemas.lesson_block import LessonBlockResponse
from app.services.lesson_block_service import LessonBlockService

client = TestClient(app, raise_server_exceptions=False)

_UUID = uuid.UUID("12345678-1234-5678-1234-567812345678")
_UUID_STR = str(_UUID)

_BLOCK = LessonBlockResponse(
    id=_UUID,
    content="Lesson content",
    summary="Lesson summary",
)

_CREATE_PAYLOAD = {
    "content": "Lesson content",
    "summary": "Lesson summary",
}


@pytest.fixture(autouse=True)
def clear_overrides():
    yield
    app.dependency_overrides.clear()


def _mock_service(**kwargs):
    mock = MagicMock(spec=LessonBlockService)
    for method, value in kwargs.items():
        if isinstance(value, Exception):
            setattr(mock, method, AsyncMock(side_effect=value))
        else:
            setattr(mock, method, AsyncMock(return_value=value))
    app.dependency_overrides[get_lesson_block_service] = lambda: mock
    return mock


class TestListLessonBlocks:
    def test_success_returns_list(self):
        _mock_service(list_blocks=[_BLOCK])
        resp = client.get("/api/v1/lesson-blocks/")
        assert resp.status_code == 200
        assert len(resp.json()) == 1
        assert resp.json()[0]["content"] == "Lesson content"

    def test_empty_list_returns_200(self):
        _mock_service(list_blocks=[])
        resp = client.get("/api/v1/lesson-blocks/")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_exception_returns_500(self):
        _mock_service(list_blocks=RuntimeError("db down"))
        resp = client.get("/api/v1/lesson-blocks/")
        assert resp.status_code == 500


class TestGetLessonBlock:
    def test_found_returns_200(self):
        _mock_service(get_block=_BLOCK)
        resp = client.get(f"/api/v1/lesson-blocks/{_UUID_STR}")
        assert resp.status_code == 200
        assert resp.json()["id"] == _UUID_STR

    def test_not_found_returns_404(self):
        _mock_service(get_block=ValueError("not found"))
        resp = client.get(f"/api/v1/lesson-blocks/{_UUID_STR}")
        assert resp.status_code == 404
        assert _UUID_STR in resp.json()["detail"]

    def test_runtime_error_returns_500(self):
        _mock_service(get_block=RuntimeError("db down"))
        resp = client.get(f"/api/v1/lesson-blocks/{_UUID_STR}")
        assert resp.status_code == 500

    def test_invalid_uuid_returns_422(self):
        resp = client.get("/api/v1/lesson-blocks/not-a-uuid")
        assert resp.status_code == 422


class TestCreateLessonBlock:
    def test_success_returns_201(self):
        _mock_service(create_block=_BLOCK)
        resp = client.post("/api/v1/lesson-blocks/", json=_CREATE_PAYLOAD)
        assert resp.status_code == 201
        assert resp.json()["content"] == "Lesson content"

    def test_with_explicit_id_returns_201(self):
        _mock_service(create_block=_BLOCK)
        payload = {**_CREATE_PAYLOAD, "id": _UUID_STR}
        resp = client.post("/api/v1/lesson-blocks/", json=payload)
        assert resp.status_code == 201

    def test_missing_required_field_returns_422(self):
        payload = {k: v for k, v in _CREATE_PAYLOAD.items() if k != "content"}
        resp = client.post("/api/v1/lesson-blocks/", json=payload)
        assert resp.status_code == 422

    def test_exception_returns_500(self):
        _mock_service(create_block=RuntimeError("db down"))
        resp = client.post("/api/v1/lesson-blocks/", json=_CREATE_PAYLOAD)
        assert resp.status_code == 500


class TestUpdateLessonBlock:
    def test_success_returns_200(self):
        updated = LessonBlockResponse(**{**_BLOCK.model_dump(), "content": "Updated content"})
        _mock_service(update_block=updated)
        resp = client.patch(f"/api/v1/lesson-blocks/{_UUID_STR}", json={"content": "Updated content"})
        assert resp.status_code == 200
        assert resp.json()["content"] == "Updated content"

    def test_partial_update_accepted(self):
        _mock_service(update_block=_BLOCK)
        resp = client.patch(f"/api/v1/lesson-blocks/{_UUID_STR}", json={})
        assert resp.status_code == 200

    def test_not_found_returns_404(self):
        _mock_service(update_block=ValueError("not found"))
        resp = client.patch(f"/api/v1/lesson-blocks/{_UUID_STR}", json={"content": "x"})
        assert resp.status_code == 404
        assert _UUID_STR in resp.json()["detail"]

    def test_runtime_error_returns_500(self):
        _mock_service(update_block=RuntimeError("db down"))
        resp = client.patch(f"/api/v1/lesson-blocks/{_UUID_STR}", json={"content": "x"})
        assert resp.status_code == 500

    def test_invalid_uuid_returns_422(self):
        resp = client.patch("/api/v1/lesson-blocks/not-a-uuid", json={"content": "x"})
        assert resp.status_code == 422


class TestDeleteLessonBlock:
    def test_success_returns_204(self):
        _mock_service(delete_block=None)
        resp = client.delete(f"/api/v1/lesson-blocks/{_UUID_STR}")
        assert resp.status_code == 204

    def test_not_found_returns_404(self):
        _mock_service(delete_block=ValueError("not found"))
        resp = client.delete(f"/api/v1/lesson-blocks/{_UUID_STR}")
        assert resp.status_code == 404
        assert _UUID_STR in resp.json()["detail"]

    def test_runtime_error_returns_500(self):
        _mock_service(delete_block=RuntimeError("db down"))
        resp = client.delete(f"/api/v1/lesson-blocks/{_UUID_STR}")
        assert resp.status_code == 500

    def test_invalid_uuid_returns_422(self):
        resp = client.delete("/api/v1/lesson-blocks/not-a-uuid")
        assert resp.status_code == 422
