"""Tests for /courses CRUD endpoints."""
import pytest
from fastapi.testclient import TestClient

from app.dependencies.course import get_course_service
from app.main import app
from app.models.course_model import CourseLevel
from app.schemas.course import CourseResponse
from app.services.course_service import CourseService

client = TestClient(app, raise_server_exceptions=False)

_COURSE = CourseResponse(
    id=1,
    name="Intro to Python",
    category=["programming"],
    tagId=None,
    enrolNum=0,
    coverImg="img.png",
    level=CourseLevel.beginner,
    description="A beginner course",
    lessonCount=5,
)

_CREATE_PAYLOAD = {
    "name": "Intro to Python",
    "category": ["programming"],
    "coverImg": "img.png",
    "level": "beginner",
    "description": "A beginner course",
}


def _mock_service(mocker, **kwargs):
    mock = mocker.MagicMock(spec=CourseService)
    for method, value in kwargs.items():
        if isinstance(value, Exception):
            getattr(mock, method).side_effect = value
        else:
            getattr(mock, method).return_value = value
    app.dependency_overrides[get_course_service] = lambda: mock
    return mock


@pytest.fixture(autouse=True)
def clear_overrides():
    yield
    app.dependency_overrides.clear()


class TestListCourses:
    def test_returns_200_with_list(self, mocker):
        _mock_service(mocker, list_courses=[_COURSE])
        resp = client.get("/api/v1/courses/")
        assert resp.status_code == 200
        assert len(resp.json()) == 1

    def test_empty_list_returns_200(self, mocker):
        _mock_service(mocker, list_courses=[])
        resp = client.get("/api/v1/courses/")
        assert resp.status_code == 200
        assert resp.json() == []


class TestGetCourse:
    def test_found_returns_200(self, mocker):
        _mock_service(mocker, get_course=_COURSE)
        resp = client.get("/api/v1/courses/1")
        assert resp.status_code == 200
        assert resp.json()["name"] == "Intro to Python"

    def test_not_found_returns_404(self, mocker):
        _mock_service(mocker, get_course=ValueError("Course 99 not found"))
        resp = client.get("/api/v1/courses/99")
        assert resp.status_code == 404


class TestCreateCourse:
    def test_success_returns_201(self, mocker):
        _mock_service(mocker, create_course=_COURSE)
        resp = client.post("/api/v1/courses/", json=_CREATE_PAYLOAD)
        assert resp.status_code == 201
        assert resp.json()["id"] == 1
        assert resp.json()["level"] == "beginner"

    def test_missing_required_field_returns_422(self, mocker):
        _mock_service(mocker)
        payload = {k: v for k, v in _CREATE_PAYLOAD.items() if k != "name"}
        resp = client.post("/api/v1/courses/", json=payload)
        assert resp.status_code == 422

    def test_invalid_level_returns_422(self, mocker):
        _mock_service(mocker)
        resp = client.post("/api/v1/courses/", json={**_CREATE_PAYLOAD, "level": "invalid"})
        assert resp.status_code == 422


class TestUpdateCourse:
    def test_success_returns_200(self, mocker):
        updated = CourseResponse(**{**_COURSE.model_dump(), "name": "Advanced Python"})
        _mock_service(mocker, update_course=updated)
        resp = client.patch("/api/v1/courses/1", json={"name": "Advanced Python"})
        assert resp.status_code == 200
        assert resp.json()["name"] == "Advanced Python"

    def test_not_found_returns_404(self, mocker):
        _mock_service(mocker, update_course=ValueError("Course 99 not found"))
        resp = client.patch("/api/v1/courses/99", json={"name": "x"})
        assert resp.status_code == 404

    def test_partial_update_accepted(self, mocker):
        _mock_service(mocker, update_course=_COURSE)
        resp = client.patch("/api/v1/courses/1", json={})
        assert resp.status_code == 200


class TestDeleteCourse:
    def test_success_returns_204(self, mocker):
        _mock_service(mocker, delete_course=None)
        resp = client.delete("/api/v1/courses/1")
        assert resp.status_code == 204

    def test_not_found_returns_404(self, mocker):
        _mock_service(mocker, delete_course=ValueError("Course 99 not found"))
        resp = client.delete("/api/v1/courses/99")
        assert resp.status_code == 404
