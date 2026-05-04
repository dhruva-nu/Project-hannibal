"""Unit tests for FastAPI dependency providers."""
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from app.dependencies.access import require_admin, require_quota
from app.dependencies.auth import get_auth_service, require_auth
from app.dependencies.db import get_db
from app.dependencies.course import get_course_service, get_lesson_service
from app.dependencies.health import get_health_service
from app.dependencies.tags import get_tags_service
from app.services.auth_service import AuthService
from app.services.course_service import CourseService
from app.services.health_service import HealthService
from app.services.lesson_service import LessonService
from app.services.tags_service import TagsService


class TestGetDb:
    def test_yields_session_and_closes(self):
        mock_db = MagicMock()
        with patch("app.dependencies.db.SessionLocal", return_value=mock_db):
            gen = get_db()
            db = next(gen)
            assert db is mock_db
            try:
                next(gen)
            except StopIteration:
                pass
        mock_db.close.assert_called_once()

    def test_closes_even_on_exception(self):
        mock_db = MagicMock()
        with patch("app.dependencies.db.SessionLocal", return_value=mock_db):
            gen = get_db()
            next(gen)
            try:
                gen.throw(RuntimeError("boom"))
            except RuntimeError:
                pass
        mock_db.close.assert_called_once()


class TestGetAuthService:
    def test_returns_auth_service_instance(self):
        svc = get_auth_service(db=MagicMock())
        assert isinstance(svc, AuthService)


class TestRequireAuth:
    def test_no_cookie_raises_401(self):
        request = MagicMock()
        request.cookies.get.return_value = None
        with pytest.raises(HTTPException) as exc:
            require_auth(request, MagicMock())
        assert exc.value.status_code == 401
        assert "Not authenticated" in exc.value.detail

    def test_invalid_token_raises_401(self):
        request = MagicMock()
        request.cookies.get.return_value = "bad-token"
        svc = MagicMock()
        svc.verify_token.side_effect = ValueError("bad")
        with pytest.raises(HTTPException) as exc:
            require_auth(request, svc)
        assert exc.value.status_code == 401

    def test_valid_token_returns_payload(self):
        request = MagicMock()
        request.cookies.get.return_value = "good-token"
        svc = MagicMock()
        svc.verify_token.return_value = {"sub": "1", "email": "u@x.com"}
        result = require_auth(request, svc)
        assert result["email"] == "u@x.com"


class TestGetHealthService:
    def test_returns_health_service_instance(self):
        svc = get_health_service()
        assert isinstance(svc, HealthService)


class TestRequireAdmin:
    def test_passes_through_payload(self):
        payload = {"sub": "1", "email": "u@x.com"}
        assert require_admin(payload) == payload

    def test_passes_any_role(self):
        payload = {"sub": "2", "email": "other@x.com", "role": "user"}
        assert require_admin(payload) == payload


class TestRequireQuota:
    def test_passes_through_payload(self):
        payload = {"sub": "1", "email": "u@x.com"}
        assert require_quota(payload) == payload

    def test_passes_when_quota_not_tracked(self):
        payload = {"sub": "2", "email": "other@x.com"}
        assert require_quota(payload) == payload


class TestGetCourseService:
    def test_returns_course_service_instance(self):
        svc = get_course_service(db=MagicMock())
        assert isinstance(svc, CourseService)

    def test_returns_lesson_service_instance(self):
        svc = get_lesson_service(db=MagicMock())
        assert isinstance(svc, LessonService)


class TestGetTagsService:
    def test_returns_tags_service_instance(self):
        svc = get_tags_service(db=MagicMock())
        assert isinstance(svc, TagsService)
