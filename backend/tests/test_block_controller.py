"""Tests for /blocks endpoints (aggregates lesson blocks + build blocks)."""

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from app.dependencies.build_block import get_build_block_service
from app.dependencies.course import get_lesson_service
from app.dependencies.lesson_block import get_lesson_block_service
from app.main import app
from app.schemas.build_block import BuildBlockResponse
from app.schemas.lesson_block import LessonBlockResponse

client = TestClient(app, raise_server_exceptions=False)

_UUID = uuid.UUID("12345678-1234-5678-1234-567812345678")
_UUID_STR = str(_UUID)

_LESSON_BLOCK = LessonBlockResponse(
    id=_UUID,
    content="Lesson content",
    summary="Lesson summary",
)

_BUILD_BLOCK = BuildBlockResponse(
    id=_UUID,
    instructions="Do this",
    input="stdin",
    output="stdout",
    test_code="assert True",
    code_template="def solve(): pass",
)


@pytest.fixture(autouse=True)
def clear_overrides():
    yield
    app.dependency_overrides.clear()


def _mock_lesson_block_svc(**kwargs):
    mock = MagicMock()
    for method, value in kwargs.items():
        if isinstance(value, Exception):
            getattr(mock, method).side_effect = value
        else:
            getattr(mock, method).__class__ = AsyncMock
            setattr(mock, method, AsyncMock(return_value=value))
    app.dependency_overrides[get_lesson_block_service] = lambda: mock
    return mock


def _mock_build_block_svc(**kwargs):
    mock = MagicMock()
    for method, value in kwargs.items():
        if isinstance(value, Exception):
            getattr(mock, method).side_effect = value
        else:
            setattr(mock, method, AsyncMock(return_value=value))
    app.dependency_overrides[get_build_block_service] = lambda: mock
    return mock


def _mock_lesson_svc(**kwargs):
    mock = MagicMock()
    for method, value in kwargs.items():
        if isinstance(value, Exception):
            getattr(mock, method).side_effect = value
        else:
            getattr(mock, method).return_value = value
    app.dependency_overrides[get_lesson_service] = lambda: mock
    return mock


class TestListBlocks:
    def test_success_returns_combined_list(self):
        mock_lb = MagicMock()
        mock_lb.list_blocks = AsyncMock(return_value=[_LESSON_BLOCK])
        app.dependency_overrides[get_lesson_block_service] = lambda: mock_lb

        mock_bb = MagicMock()
        mock_bb.list_blocks = AsyncMock(return_value=[_BUILD_BLOCK])
        app.dependency_overrides[get_build_block_service] = lambda: mock_bb

        resp = client.get("/api/v1/blocks/")

        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        types = {item["type"] for item in data}
        assert types == {"lesson", "build"}

    def test_empty_stores_returns_empty_list(self):
        mock_lb = MagicMock()
        mock_lb.list_blocks = AsyncMock(return_value=[])
        app.dependency_overrides[get_lesson_block_service] = lambda: mock_lb

        mock_bb = MagicMock()
        mock_bb.list_blocks = AsyncMock(return_value=[])
        app.dependency_overrides[get_build_block_service] = lambda: mock_bb

        resp = client.get("/api/v1/blocks/")

        assert resp.status_code == 200
        assert resp.json() == []

    def test_exception_returns_503(self):
        mock_lb = MagicMock()
        mock_lb.list_blocks = AsyncMock(side_effect=RuntimeError("db down"))
        app.dependency_overrides[get_lesson_block_service] = lambda: mock_lb

        mock_bb = MagicMock()
        mock_bb.list_blocks = AsyncMock(return_value=[])
        app.dependency_overrides[get_build_block_service] = lambda: mock_bb

        resp = client.get("/api/v1/blocks/")

        assert resp.status_code == 503


class TestGetLessonObject:
    def _setup_lesson_svc(self, nosql_id=_UUID, side_effect=None):
        mock = MagicMock()
        lesson = MagicMock()
        lesson.nosqlId = nosql_id
        if side_effect is not None:
            mock.get_lesson.side_effect = side_effect
        else:
            mock.get_lesson.return_value = lesson
        app.dependency_overrides[get_lesson_service] = lambda: mock
        return mock

    def _setup_block_svc(self, return_value=None, side_effect=None):
        mock = MagicMock()
        if side_effect is not None:
            mock.get_block = AsyncMock(side_effect=side_effect)
        else:
            mock.get_block = AsyncMock(return_value=return_value or _LESSON_BLOCK)
        app.dependency_overrides[get_lesson_block_service] = lambda: mock
        return mock

    def test_success_returns_lesson_block(self):
        self._setup_lesson_svc()
        self._setup_block_svc()

        resp = client.get("/api/v1/blocks/1")

        assert resp.status_code == 200
        assert resp.json()["content"] == "Lesson content"

    def test_lesson_not_found_returns_404(self):
        self._setup_lesson_svc(side_effect=ValueError("not found"))
        # block service still needed as dependency
        self._setup_block_svc()

        resp = client.get("/api/v1/blocks/99")

        assert resp.status_code == 404
        assert "99" in resp.json()["detail"]

    def test_lesson_runtime_error_returns_500(self):
        self._setup_lesson_svc(side_effect=RuntimeError("db down"))
        self._setup_block_svc()

        resp = client.get("/api/v1/blocks/1")

        assert resp.status_code == 500

    def test_block_not_found_returns_404(self):
        self._setup_lesson_svc()
        self._setup_block_svc(side_effect=ValueError("block missing"))

        resp = client.get("/api/v1/blocks/1")

        assert resp.status_code == 404
        assert "document store" in resp.json()["detail"]

    def test_block_runtime_error_returns_500(self):
        self._setup_lesson_svc()
        self._setup_block_svc(side_effect=RuntimeError("nosql down"))

        resp = client.get("/api/v1/blocks/1")

        assert resp.status_code == 500
