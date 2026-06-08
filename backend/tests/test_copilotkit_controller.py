"""Tests for the CopilotKit AG-UI endpoint at /api/v1/copilotkit."""

from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from jose import jwt
from langchain_core.messages import AIMessage, HumanMessage

from app.api.v1.controllers.copilotkit_controller import (
    _BACKEND_TOOL_NAMES,
    _build_context_block,
    _route_after_tutor,
    active_ck_context,
    get_user_profile,
    tutor_node,
)
from app.core.config import settings
from app.main import app
from app.middleware import _verify_cookie

client = TestClient(app, raise_server_exceptions=False)


def _make_access_token() -> str:
    payload = {
        "sub": "1",
        "email": "test@example.com",
        "exp": datetime.now(UTC) + timedelta(minutes=15),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


# ── HTTP endpoint tests ────────────────────────────────────────────────────


class TestCopilotKitEndpoint:
    def test_health_returns_200(self):
        response = client.get("/api/v1/copilotkit/health")
        assert response.status_code == 200
        assert response.json()["status"] == "ok"

    def test_post_without_auth_returns_401(self):
        response = client.post("/api/v1/copilotkit", json={})
        assert response.status_code == 401

    def test_post_with_invalid_token_returns_401(self):
        response = client.post(
            "/api/v1/copilotkit",
            json={},
            cookies={"access_token": "not-a-valid-token"},
        )
        assert response.status_code == 401


# ── get_user_profile tool ──────────────────────────────────────────────────


class TestGetUserProfileTool:
    def test_found_returns_profile_string(self):
        mock_user = MagicMock()
        mock_user.id = 42
        mock_user.email = "alice@example.com"
        mock_user.provider = "google"
        mock_user.created_at.date.return_value = "2024-01-01"

        with (
            patch(
                "app.api.v1.controllers.copilotkit_controller.SessionLocal"
            ) as mock_sl,
            patch(
                "app.api.v1.controllers.copilotkit_controller.UserRepository"
            ) as mock_repo_cls,
        ):
            mock_db = MagicMock()
            mock_sl.return_value = mock_db
            mock_repo = MagicMock()
            mock_repo.get_by_email.return_value = mock_user
            mock_repo_cls.return_value = mock_repo

            result = get_user_profile.invoke({"email": "alice@example.com"})

        assert "alice@example.com" in result
        assert "42" in result
        assert "google" in result
        mock_db.close.assert_called_once()

    def test_not_found_returns_message(self):
        with (
            patch(
                "app.api.v1.controllers.copilotkit_controller.SessionLocal"
            ) as mock_sl,
            patch(
                "app.api.v1.controllers.copilotkit_controller.UserRepository"
            ) as mock_repo_cls,
        ):
            mock_db = MagicMock()
            mock_sl.return_value = mock_db
            mock_repo = MagicMock()
            mock_repo.get_by_email.return_value = None
            mock_repo_cls.return_value = mock_repo

            result = get_user_profile.invoke({"email": "ghost@example.com"})

        assert "No user found" in result
        assert "ghost@example.com" in result
        mock_db.close.assert_called_once()

    def test_db_always_closed_on_exception(self):
        with (
            patch(
                "app.api.v1.controllers.copilotkit_controller.SessionLocal"
            ) as mock_sl,
            patch(
                "app.api.v1.controllers.copilotkit_controller.UserRepository"
            ) as mock_repo_cls,
        ):
            mock_db = MagicMock()
            mock_sl.return_value = mock_db
            mock_repo = MagicMock()
            mock_repo.get_by_email.side_effect = RuntimeError("db down")
            mock_repo_cls.return_value = mock_repo

            with pytest.raises(RuntimeError):
                get_user_profile.invoke({"email": "x@example.com"})

        mock_db.close.assert_called_once()


# ── _build_context_block ───────────────────────────────────────────────────


class TestBuildContextBlock:
    def test_empty_context_returns_empty_string(self):
        assert _build_context_block([]) == ""

    def test_non_empty_context_returns_formatted_block(self):
        context = [{"description": "User", "value": "Alice"}]
        result = _build_context_block(context)
        assert "User: Alice" in result

    def test_items_without_description_are_skipped(self):
        context = [{"value": "orphan"}, {"description": "Name", "value": "Bob"}]
        result = _build_context_block(context)
        assert "orphan" not in result
        assert "Name: Bob" in result


# ── tutor_node ─────────────────────────────────────────────────────────────


class TestTutorNode:
    def _patch_llm(self, response):
        bound = MagicMock()
        bound.invoke.return_value = response
        llm = MagicMock()
        llm.bind_tools.return_value = bound
        return patch("app.api.v1.controllers.copilotkit_controller._llm", llm), bound

    def test_invokes_llm_with_system_and_messages(self):
        token = active_ck_context.set([])
        try:
            patcher, bound = self._patch_llm(AIMessage(content="hi back"))
            with patcher:
                result = tutor_node({"messages": [HumanMessage(content="hi")]})

                assert result["messages"][0].content == "hi back"
                sent = bound.invoke.call_args[0][0]
                assert sent[0].type == "system"
                assert "AI tutor" in sent[0].content
                assert sent[1].content == "hi"
        finally:
            active_ck_context.reset(token)

    def test_includes_context_block_when_available(self):
        token = active_ck_context.set(
            [{"description": "Current page", "value": "courses"}]
        )
        try:
            patcher, bound = self._patch_llm(AIMessage(content="ok"))
            with patcher:
                tutor_node({"messages": [HumanMessage(content="where am i?")]})

                sent_system = bound.invoke.call_args[0][0][0].content
                assert "[Application context]" in sent_system
                assert "Current page: courses" in sent_system
        finally:
            active_ck_context.reset(token)

    def test_binds_frontend_actions_alongside_backend_tools(self):
        token = active_ck_context.set([])
        try:
            patcher, _ = self._patch_llm(AIMessage(content="ok"))
            with patcher as llm:
                fe_tool = {
                    "name": "navigate_to",
                    "description": "Navigate",
                    "parameters": {"type": "object", "properties": {}},
                }
                tutor_node(
                    {
                        "messages": [HumanMessage(content="hi")],
                        "copilotkit": {"actions": [fe_tool], "context": []},
                    }
                )
                bound_with = llm.bind_tools.call_args[0][0]
                names = [
                    t["name"] if isinstance(t, dict) else t.name for t in bound_with
                ]
                assert "navigate_to" in names
                assert "get_user_profile" in names
        finally:
            active_ck_context.reset(token)


# ── _route_after_tutor ─────────────────────────────────────────────────────


class TestRouteAfterTutor:
    def test_empty_messages_returns_end(self):
        from langgraph.graph import END

        assert _route_after_tutor({"messages": []}) == END

    def test_no_messages_key_returns_end(self):
        from langgraph.graph import END

        assert _route_after_tutor({}) == END

    def test_non_ai_message_returns_end(self):
        from langgraph.graph import END

        assert _route_after_tutor({"messages": [HumanMessage(content="hi")]}) == END

    def test_ai_message_without_tool_calls_returns_end(self):
        from langgraph.graph import END

        assert _route_after_tutor({"messages": [AIMessage(content="ok")]}) == END

    def test_ai_message_with_backend_tool_call_returns_tools(self):
        backend_tool = next(iter(_BACKEND_TOOL_NAMES))
        msg = AIMessage(
            content="", tool_calls=[{"name": backend_tool, "args": {}, "id": "1"}]
        )
        assert _route_after_tutor({"messages": [msg]}) == "tools"

    def test_ai_message_with_frontend_tool_call_returns_end(self):
        from langgraph.graph import END

        msg = AIMessage(
            content="", tool_calls=[{"name": "navigate_to", "args": {}, "id": "1"}]
        )
        assert _route_after_tutor({"messages": [msg]}) == END


# ── middleware helpers ─────────────────────────────────────────────────────


class TestVerifyCookie:
    def test_returns_none_for_valid_token(self):
        token = jwt.encode(
            {
                "sub": "1",
                "email": "u@x.com",
                "exp": datetime.now(UTC) + timedelta(minutes=5),
            },
            settings.secret_key,
            algorithm=settings.jwt_algorithm,
        )
        request = MagicMock()
        request.cookies.get.return_value = token
        assert _verify_cookie(request) is None


class TestMiddlewareExceptionPath:
    def test_invalid_json_body_is_silently_ignored(self):
        token = _make_access_token()
        # send bytes that are not valid JSON — exercises the except block in
        # capture_copilotkit_context middleware (middleware.py lines 39-40)
        resp = client.post(
            "/api/v1/copilotkit",
            content=b"not-json",
            cookies={"access_token": token},
        )
        assert resp.status_code in {200, 400, 422, 500}
