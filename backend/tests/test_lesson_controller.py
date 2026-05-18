"""Tests for /lessons CRUD endpoints."""

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from app.dependencies.course import get_lesson_block_service, get_lesson_service
from app.main import app
from app.models.lesson_model import LessonType
from app.schemas.lesson import LessonResponse
from app.services.lesson_service import LessonService

client = TestClient(app, raise_server_exceptions=False)

_UUID = uuid.UUID("12345678-1234-5678-1234-567812345678")

_LESSON = LessonResponse(
    id=1,
    courseId=1,
    name="Lesson 1",
    learning="You will learn X",
    nosqlId=_UUID,
    lessonType=LessonType.learn,
    order=1,
)

_CREATE_PAYLOAD = {
    "courseId": 1,
    "name": "Lesson 1",
    "learning": "You will learn X",
    "nosqlId": str(_UUID),
    "lessonType": "learn",
}


def _mock_service(mocker, **kwargs):
    mock = mocker.MagicMock(spec=LessonService)
    for method, value in kwargs.items():
        if isinstance(value, Exception):
            getattr(mock, method).side_effect = value
        else:
            getattr(mock, method).return_value = value
    app.dependency_overrides[get_lesson_service] = lambda: mock
    return mock


@pytest.fixture(autouse=True)
def clear_overrides():
    yield
    app.dependency_overrides.clear()


class TestListLessons:
    def test_returns_200_with_list(self, mocker):
        _mock_service(mocker, list_lessons=[_LESSON])
        resp = client.get("/api/v1/lessons/")
        assert resp.status_code == 200
        assert len(resp.json()) == 1

    def test_empty_list_returns_200(self, mocker):
        _mock_service(mocker, list_lessons=[])
        resp = client.get("/api/v1/lessons/")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_service_error_returns_500(self, mocker):
        _mock_service(mocker, list_lessons=RuntimeError("db down"))
        resp = client.get("/api/v1/lessons/")
        assert resp.status_code == 500


class TestListLessonsByCourse:
    def test_returns_lessons_for_course(self, mocker):
        _mock_service(mocker, list_by_course=[_LESSON])
        resp = client.get("/api/v1/lessons/course/1")
        assert resp.status_code == 200
        assert resp.json()[0]["courseId"] == 1

    def test_no_lessons_returns_empty(self, mocker):
        _mock_service(mocker, list_by_course=[])
        resp = client.get("/api/v1/lessons/course/99")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_service_error_returns_500(self, mocker):
        _mock_service(mocker, list_by_course=RuntimeError("db down"))
        resp = client.get("/api/v1/lessons/course/1")
        assert resp.status_code == 500


class TestGetLesson:
    def test_found_returns_200(self, mocker):
        _mock_service(mocker, get_lesson=_LESSON)
        resp = client.get("/api/v1/lessons/1")
        assert resp.status_code == 200
        assert resp.json()["name"] == "Lesson 1"

    def test_not_found_returns_404(self, mocker):
        _mock_service(mocker, get_lesson=ValueError("Lesson 99 not found"))
        resp = client.get("/api/v1/lessons/99")
        assert resp.status_code == 404

    def test_service_error_returns_500(self, mocker):
        _mock_service(mocker, get_lesson=RuntimeError("db down"))
        resp = client.get("/api/v1/lessons/1")
        assert resp.status_code == 500


class TestCreateLesson:
    def test_success_returns_201(self, mocker):
        _mock_service(mocker, create_lesson=_LESSON)
        mock_block_svc = MagicMock()
        mock_block_svc.create_block = AsyncMock()
        app.dependency_overrides[get_lesson_block_service] = lambda: mock_block_svc
        resp = client.post("/api/v1/lessons/", json=_CREATE_PAYLOAD)
        assert resp.status_code == 201
        assert resp.json()["lessonType"] == "learn"

    def test_missing_required_field_returns_422(self, mocker):
        _mock_service(mocker)
        payload = {k: v for k, v in _CREATE_PAYLOAD.items() if k != "courseId"}
        resp = client.post("/api/v1/lessons/", json=payload)
        assert resp.status_code == 422

    def test_invalid_lesson_type_returns_422(self, mocker):
        _mock_service(mocker)
        resp = client.post(
            "/api/v1/lessons/", json={**_CREATE_PAYLOAD, "lessonType": "watch"}
        )
        assert resp.status_code == 422

    def test_invalid_uuid_returns_422(self, mocker):
        _mock_service(mocker)
        resp = client.post(
            "/api/v1/lessons/", json={**_CREATE_PAYLOAD, "nosqlId": "not-a-uuid"}
        )
        assert resp.status_code == 422

    def test_lesson_service_error_returns_500(self, mocker):
        _mock_service(mocker, create_lesson=RuntimeError("db down"))
        mock_block_svc = MagicMock()
        mock_block_svc.create_block = AsyncMock()
        app.dependency_overrides[get_lesson_block_service] = lambda: mock_block_svc
        resp = client.post("/api/v1/lessons/", json=_CREATE_PAYLOAD)
        assert resp.status_code == 500

    def test_block_service_error_returns_500(self, mocker):
        _mock_service(mocker, create_lesson=_LESSON)
        mock_block_svc = MagicMock()
        mock_block_svc.create_block = AsyncMock(side_effect=RuntimeError("nosql down"))
        app.dependency_overrides[get_lesson_block_service] = lambda: mock_block_svc
        resp = client.post("/api/v1/lessons/", json=_CREATE_PAYLOAD)
        assert resp.status_code == 500


class TestUpdateLesson:
    def test_success_returns_200(self, mocker):
        updated = LessonResponse(**{**_LESSON.model_dump(), "name": "Updated Lesson"})
        _mock_service(mocker, update_lesson=updated)
        resp = client.patch("/api/v1/lessons/1", json={"name": "Updated Lesson"})
        assert resp.status_code == 200
        assert resp.json()["name"] == "Updated Lesson"

    def test_not_found_returns_404(self, mocker):
        _mock_service(mocker, update_lesson=ValueError("Lesson 99 not found"))
        resp = client.patch("/api/v1/lessons/99", json={"name": "x"})
        assert resp.status_code == 404

    def test_partial_update_accepted(self, mocker):
        _mock_service(mocker, update_lesson=_LESSON)
        resp = client.patch("/api/v1/lessons/1", json={})
        assert resp.status_code == 200

    def test_service_error_returns_500(self, mocker):
        _mock_service(mocker, update_lesson=RuntimeError("db down"))
        resp = client.patch("/api/v1/lessons/1", json={"name": "x"})
        assert resp.status_code == 500


class TestDeleteLesson:
    def test_success_returns_204(self, mocker):
        _mock_service(mocker, delete_lesson=None)
        resp = client.delete("/api/v1/lessons/1")
        assert resp.status_code == 204

    def test_not_found_returns_404(self, mocker):
        _mock_service(mocker, delete_lesson=ValueError("Lesson 99 not found"))
        resp = client.delete("/api/v1/lessons/99")
        assert resp.status_code == 404

    def test_service_error_returns_500(self, mocker):
        _mock_service(mocker, delete_lesson=RuntimeError("db down"))
        resp = client.delete("/api/v1/lessons/1")
        assert resp.status_code == 500
