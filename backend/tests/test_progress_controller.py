"""Tests for /progress endpoints."""

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.dependencies.auth import require_auth
from app.dependencies.progress import get_progress_service
from app.main import app
from app.schemas.progress import CourseProgressResponse
from app.services.progress_service import ProgressService

client = TestClient(app, raise_server_exceptions=False)

_USER_PAYLOAD = {"sub": "1", "email": "user@example.com", "role": "student"}

_PROGRESS = CourseProgressResponse(
    courseId=10,
    completedLessonIds=[100],
    activeLessonId=101,
    placedNodeIds=["node-a"],
    enrolledAt=datetime(2026, 6, 5, tzinfo=timezone.utc),
)


def _mock_service(mocker, **kwargs):
    mock = mocker.MagicMock(spec=ProgressService)
    for method, value in kwargs.items():
        if isinstance(value, Exception):
            getattr(mock, method).side_effect = value
        else:
            getattr(mock, method).return_value = value
    app.dependency_overrides[get_progress_service] = lambda: mock
    app.dependency_overrides[require_auth] = lambda: _USER_PAYLOAD
    return mock


@pytest.fixture(autouse=True)
def clear_overrides():
    yield
    app.dependency_overrides.clear()


class TestGetProgress:
    def test_returns_200(self, mocker):
        _mock_service(mocker, get_progress=_PROGRESS)
        resp = client.get("/api/v1/progress/courses/10")
        assert resp.status_code == 200
        assert resp.json()["completedLessonIds"] == [100]

    def test_not_enrolled_returns_404(self, mocker):
        _mock_service(mocker, get_progress=ValueError("not enrolled"))
        resp = client.get("/api/v1/progress/courses/10")
        assert resp.status_code == 404

    def test_unauthenticated_returns_401(self):
        resp = client.get("/api/v1/progress/courses/10")
        assert resp.status_code == 401


class TestEnroll:
    def test_returns_201(self, mocker):
        _mock_service(mocker, enroll=_PROGRESS)
        resp = client.post("/api/v1/progress/courses/10/enroll")
        assert resp.status_code == 201
        assert resp.json()["courseId"] == 10

    def test_course_missing_returns_404(self, mocker):
        _mock_service(mocker, enroll=ValueError("Course 10 not found"))
        resp = client.post("/api/v1/progress/courses/10/enroll")
        assert resp.status_code == 404


class TestUpdateProgress:
    def test_patch_active_lesson_returns_200(self, mocker):
        mock = _mock_service(mocker, update_progress=_PROGRESS)
        resp = client.patch(
            "/api/v1/progress/courses/10",
            json={"activeLessonId": 101},
        )
        assert resp.status_code == 200
        mock.update_progress.assert_called_once_with(
            1, 10, active_lesson_id=101, placed_node_ids=None
        )

    def test_patch_placed_nodes_returns_200(self, mocker):
        mock = _mock_service(mocker, update_progress=_PROGRESS)
        resp = client.patch(
            "/api/v1/progress/courses/10",
            json={"placedNodeIds": ["n1", "n2"]},
        )
        assert resp.status_code == 200
        mock.update_progress.assert_called_once_with(
            1, 10, active_lesson_id=None, placed_node_ids=["n1", "n2"]
        )

    def test_invalid_lesson_returns_404(self, mocker):
        _mock_service(mocker, update_progress=ValueError("does not belong"))
        resp = client.patch(
            "/api/v1/progress/courses/10",
            json={"activeLessonId": 999},
        )
        assert resp.status_code == 404


class TestCompleteLesson:
    def test_returns_200(self, mocker):
        _mock_service(mocker, complete_lesson=_PROGRESS)
        resp = client.post("/api/v1/progress/courses/10/lessons/100/complete")
        assert resp.status_code == 200

    def test_invalid_lesson_returns_404(self, mocker):
        _mock_service(mocker, complete_lesson=ValueError("does not belong"))
        resp = client.post("/api/v1/progress/courses/10/lessons/999/complete")
        assert resp.status_code == 404


class TestResetProgress:
    def test_returns_204(self, mocker):
        _mock_service(mocker, reset_progress=None)
        resp = client.delete("/api/v1/progress/courses/10")
        assert resp.status_code == 204
