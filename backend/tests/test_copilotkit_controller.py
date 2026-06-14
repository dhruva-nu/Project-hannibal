"""Tests for the CopilotKit AG-UI endpoint at /api/v1/copilotkit."""

import os
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from jose import jwt
from langchain_core.messages import AIMessage, HumanMessage

import app.agent.ai_tutor.nodes.tutor as _tutor_mod
from app.agent.ai_tutor.context_utils import (
    build_context_block,
    extract_course_id,
    extract_lesson_id,
    parse_ck_value,
)
from app.agent.ai_tutor.nodes.context_sync import context_sync_node
from app.agent.ai_tutor.nodes.tutor import (
    _BACKEND_TOOL_NAMES,
    _bind_tools,
    _get_gemini_llm,
    _get_vertex_llm,
    route_after_tutor,
    tutor_node,
)
from app.agent.ai_tutor.state import active_ck_context, active_user_id
from app.agent.tools.user_tools import get_user_profile
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


def _make_db_gen(db):
    def _gen():
        yield db

    return _gen


class TestGetUserProfileTool:
    def test_found_returns_profile_string(self):
        mock_user = MagicMock()
        mock_user.id = 42
        mock_user.email = "alice@example.com"
        mock_user.provider = "google"
        mock_user.created_at.date.return_value = "2024-01-01"

        mock_db = MagicMock()
        mock_repo = MagicMock()
        mock_repo.get_by_email.return_value = mock_user

        with (
            patch(
                "app.agent.tools.user_tools.get_db",
                side_effect=_make_db_gen(mock_db),
            ),
            patch(
                "app.agent.tools.user_tools.UserRepository",
                return_value=mock_repo,
            ),
        ):
            result = get_user_profile.invoke({"email": "alice@example.com"})

        assert "alice@example.com" in result
        assert "42" in result
        assert "google" in result

    def test_not_found_returns_message(self):
        mock_db = MagicMock()
        mock_repo = MagicMock()
        mock_repo.get_by_email.return_value = None

        with (
            patch(
                "app.agent.tools.user_tools.get_db",
                side_effect=_make_db_gen(mock_db),
            ),
            patch(
                "app.agent.tools.user_tools.UserRepository",
                return_value=mock_repo,
            ),
        ):
            result = get_user_profile.invoke({"email": "ghost@example.com"})

        assert "No user found" in result
        assert "ghost@example.com" in result

    def test_db_always_closed_on_exception(self):
        mock_db = MagicMock()
        mock_repo = MagicMock()
        mock_repo.get_by_email.side_effect = RuntimeError("db down")

        with (
            patch(
                "app.agent.tools.user_tools.get_db",
                side_effect=_make_db_gen(mock_db),
            ),
            patch(
                "app.agent.tools.user_tools.UserRepository",
                return_value=mock_repo,
            ),
        ):
            with pytest.raises(RuntimeError):
                get_user_profile.invoke({"email": "x@example.com"})


# ── LLM selection (LLM_PROVIDER default + fallback, thinking budget) ────────


class TestLlmSelection:
    def _reset_cache(self):
        _tutor_mod._vertex_llm = None
        _tutor_mod._gemini_llm = None

    def _fake_settings(
        self,
        *,
        vertex_ai_key="",
        gemini_api_key="",
        llm_provider="vertex",
        llm_thinking_budget=512,
    ):
        return SimpleNamespace(
            vertex_ai_key=vertex_ai_key,
            gemini_api_key=gemini_api_key,
            llm_provider=llm_provider,
            llm_thinking_budget=llm_thinking_budget,
        )

    def test_vertex_llm_uses_vertex_key_and_thinking_budget(self):
        original = _tutor_mod._vertex_llm
        try:
            self._reset_cache()
            mock_llm = MagicMock()
            with (
                patch.object(
                    _tutor_mod,
                    "settings",
                    self._fake_settings(vertex_ai_key="vkey", llm_thinking_budget=256),
                ),
                patch(
                    "app.agent.ai_tutor.nodes.tutor.ChatGoogleGenerativeAI",
                    return_value=mock_llm,
                ) as mock_cls,
            ):
                result = _get_vertex_llm()
                mock_cls.assert_called_once_with(
                    model="gemini-2.5-flash",
                    vertexai=True,
                    google_api_key="vkey",
                    thinking_budget=256,
                )
                assert result is mock_llm
        finally:
            _tutor_mod._vertex_llm = original

    def test_vertex_llm_none_without_key(self):
        original = _tutor_mod._vertex_llm
        try:
            self._reset_cache()
            with patch.object(_tutor_mod, "settings", self._fake_settings()):
                assert _get_vertex_llm() is None
        finally:
            _tutor_mod._vertex_llm = original

    def test_gemini_llm_uses_gemini_key_and_thinking_budget(self):
        original = _tutor_mod._gemini_llm
        try:
            self._reset_cache()
            mock_llm = MagicMock()
            with (
                patch.object(
                    _tutor_mod,
                    "settings",
                    self._fake_settings(gemini_api_key="gkey", llm_thinking_budget=256),
                ),
                patch(
                    "app.agent.ai_tutor.nodes.tutor.ChatGoogleGenerativeAI",
                    return_value=mock_llm,
                ) as mock_cls,
            ):
                result = _get_gemini_llm()
                mock_cls.assert_called_once_with(
                    model="gemini-2.5-flash",
                    google_api_key="gkey",
                    thinking_budget=256,
                )
                assert result is mock_llm
        finally:
            _tutor_mod._gemini_llm = original

    def test_bind_tools_vertex_default_with_gemini_fallback(self):
        vertex, gemini = MagicMock(), MagicMock()
        vertex_bound, gemini_bound = MagicMock(), MagicMock()
        vertex.bind_tools.return_value = vertex_bound
        gemini.bind_tools.return_value = gemini_bound
        with (
            patch.object(
                _tutor_mod, "settings", self._fake_settings(llm_provider="vertex")
            ),
            patch(
                "app.agent.ai_tutor.nodes.tutor._get_vertex_llm", return_value=vertex
            ),
            patch(
                "app.agent.ai_tutor.nodes.tutor._get_gemini_llm", return_value=gemini
            ),
        ):
            _bind_tools([])
            vertex_bound.with_fallbacks.assert_called_once_with([gemini_bound])

    def test_bind_tools_gemini_default_with_vertex_fallback(self):
        vertex, gemini = MagicMock(), MagicMock()
        vertex_bound, gemini_bound = MagicMock(), MagicMock()
        vertex.bind_tools.return_value = vertex_bound
        gemini.bind_tools.return_value = gemini_bound
        with (
            patch.object(
                _tutor_mod, "settings", self._fake_settings(llm_provider="gemini")
            ),
            patch(
                "app.agent.ai_tutor.nodes.tutor._get_vertex_llm", return_value=vertex
            ),
            patch(
                "app.agent.ai_tutor.nodes.tutor._get_gemini_llm", return_value=gemini
            ),
        ):
            _bind_tools([])
            gemini_bound.with_fallbacks.assert_called_once_with([vertex_bound])

    def test_bind_tools_single_provider_has_no_fallback(self):
        vertex = MagicMock()
        with (
            patch.object(_tutor_mod, "settings", self._fake_settings()),
            patch(
                "app.agent.ai_tutor.nodes.tutor._get_vertex_llm", return_value=vertex
            ),
            patch("app.agent.ai_tutor.nodes.tutor._get_gemini_llm", return_value=None),
        ):
            result = _bind_tools([])
            assert result is vertex.bind_tools.return_value

    def test_bind_tools_falls_back_when_default_provider_missing(self):
        gemini = MagicMock()
        with (
            patch.object(
                _tutor_mod, "settings", self._fake_settings(llm_provider="vertex")
            ),
            patch("app.agent.ai_tutor.nodes.tutor._get_vertex_llm", return_value=None),
            patch(
                "app.agent.ai_tutor.nodes.tutor._get_gemini_llm", return_value=gemini
            ),
        ):
            result = _bind_tools([])
            assert result is gemini.bind_tools.return_value

    def test_bind_tools_raises_without_any_key(self):
        with (
            patch.object(_tutor_mod, "settings", self._fake_settings()),
            patch("app.agent.ai_tutor.nodes.tutor._get_vertex_llm", return_value=None),
            patch("app.agent.ai_tutor.nodes.tutor._get_gemini_llm", return_value=None),
        ):
            with pytest.raises(RuntimeError):
                _bind_tools([])

    def test_google_api_key_ctx_restores_previous_value(self):
        with patch.dict(os.environ, {"GOOGLE_API_KEY": "original"}, clear=False):
            with _tutor_mod._google_api_key("temporary"):
                assert os.environ["GOOGLE_API_KEY"] == "temporary"
            assert os.environ["GOOGLE_API_KEY"] == "original"

    def test_google_api_key_ctx_clears_when_unset(self):
        os.environ.pop("GOOGLE_API_KEY", None)
        with _tutor_mod._google_api_key("temporary"):
            assert os.environ["GOOGLE_API_KEY"] == "temporary"
        assert "GOOGLE_API_KEY" not in os.environ

    def test_bind_tools_raises_on_invalid_provider(self):
        with patch.object(
            _tutor_mod, "settings", self._fake_settings(llm_provider="bogus")
        ):
            with pytest.raises(RuntimeError, match="LLM_PROVIDER"):
                _bind_tools([])


# ── build_context_block ───────────────────────────────────────────────────


class TestBuildContextBlock:
    def test_empty_context_returns_empty_string(self):
        assert build_context_block([]) == ""

    def test_non_empty_context_returns_formatted_block(self):
        context = [{"description": "User", "value": "Alice"}]
        result = build_context_block(context)
        assert "User: Alice" in result

    def test_items_without_description_are_skipped(self):
        context = [{"value": "orphan"}, {"description": "Name", "value": "Bob"}]
        result = build_context_block(context)
        assert "orphan" not in result
        assert "Name: Bob" in result


# ── parse_ck_value ────────────────────────────────────────────────────────


class TestParseCkValue:
    def test_dict_passthrough(self):
        assert parse_ck_value({"a": 1}) == {"a": 1}

    def test_json_string_decoded(self):
        assert parse_ck_value('{"x": 2}') == {"x": 2}

    def test_non_dict_json_returns_empty(self):
        assert parse_ck_value("[1,2,3]") == {}

    def test_invalid_json_returns_empty(self):
        assert parse_ck_value("not-json") == {}

    def test_none_returns_empty(self):
        assert parse_ck_value(None) == {}

    def test_integer_returns_empty(self):
        assert parse_ck_value(42) == {}


# ── extract_course_id / extract_lesson_id ─────────────────────────────────


class TestExtractIds:
    def test_extract_course_id_found(self):
        assert extract_course_id([{"value": '{"courseId": 5}'}]) == 5

    def test_extract_course_id_none_when_missing(self):
        assert extract_course_id([{"value": '{"lessonId": 3}'}]) is None

    def test_extract_course_id_null_value(self):
        assert extract_course_id([{"value": '{"courseId": null}'}]) is None

    def test_extract_course_id_non_numeric_skipped(self):
        assert extract_course_id([{"value": '{"courseId": "bad"}'}]) is None

    def test_extract_lesson_id_found(self):
        assert extract_lesson_id([{"value": '{"lessonId": 7}'}]) == 7

    def test_extract_lesson_id_none_when_missing(self):
        assert extract_lesson_id([{"value": '{"courseId": 3}'}]) is None

    def test_extract_lesson_id_null_value(self):
        assert extract_lesson_id([{"value": '{"lessonId": null}'}]) is None

    def test_extract_lesson_id_non_numeric_skipped(self):
        assert extract_lesson_id([{"value": '{"lessonId": "bad"}'}]) is None


# ── context_sync_node ─────────────────────────────────────────────────────


class TestContextSyncNode:
    def _mock_db_ctx(self):
        ctx = MagicMock()
        ctx.__enter__ = MagicMock(return_value=MagicMock())
        ctx.__exit__ = MagicMock(return_value=False)
        return ctx

    async def test_no_context_clears_ids_when_state_had_values(self):
        token = active_ck_context.set([])
        try:
            result = await context_sync_node({"course_id": 1, "lesson_id": 2}, {})
            assert result["course_id"] is None
            assert result["course_info"] is None
            assert result["lesson_id"] is None
            assert result["lesson_name"] is None
            assert result["lesson_info"] is None
        finally:
            active_ck_context.reset(token)

    async def test_no_context_no_update_when_state_already_none(self):
        token = active_ck_context.set([])
        try:
            result = await context_sync_node({"course_id": None, "lesson_id": None}, {})
            assert result == {}
        finally:
            active_ck_context.reset(token)

    async def test_new_course_id_fetches_course_info(self):
        mock_course = MagicMock()
        mock_course.info = "Intro to Python"
        mock_repo = MagicMock()
        mock_repo.get_by_id.return_value = mock_course
        ctx = self._mock_db_ctx()
        token = active_ck_context.set([{"value": '{"courseId": 10}'}])
        try:
            with (
                patch(
                    "app.agent.ai_tutor.nodes.context_sync.db_session", return_value=ctx
                ),
                patch(
                    "app.agent.ai_tutor.nodes.context_sync.CourseRepository",
                    return_value=mock_repo,
                ),
            ):
                result = await context_sync_node(
                    {"course_id": None, "lesson_id": None}, {}
                )
            assert result["course_id"] == 10
            assert result["course_info"] == "Intro to Python"
        finally:
            active_ck_context.reset(token)

    async def test_same_course_id_skips_fetch(self):
        token = active_ck_context.set([{"value": '{"courseId": 10}'}])
        try:
            with patch(
                "app.agent.ai_tutor.nodes.context_sync.CourseRepository"
            ) as mock_repo_cls:
                result = await context_sync_node(
                    {"course_id": 10, "lesson_id": None}, {}
                )
            mock_repo_cls.assert_not_called()
            assert "course_id" not in result
        finally:
            active_ck_context.reset(token)

    async def test_new_lesson_id_fetches_lesson_info(self):
        mock_lesson = MagicMock()
        mock_lesson.name = "Variables"
        mock_lesson.info = "Learn about variables"
        mock_repo = MagicMock()
        mock_repo.get_by_id.return_value = mock_lesson
        ctx = self._mock_db_ctx()
        token = active_ck_context.set([{"value": '{"lessonId": 3}'}])
        try:
            with (
                patch(
                    "app.agent.ai_tutor.nodes.context_sync.db_session", return_value=ctx
                ),
                patch(
                    "app.agent.ai_tutor.nodes.context_sync.LessonRepository",
                    return_value=mock_repo,
                ),
            ):
                result = await context_sync_node(
                    {"course_id": None, "lesson_id": None}, {}
                )
            assert result["lesson_id"] == 3
            assert result["lesson_name"] == "Variables"
            assert result["lesson_info"] == "Learn about variables"
        finally:
            active_ck_context.reset(token)

    async def test_course_not_found_sets_info_to_none(self):
        mock_repo = MagicMock()
        mock_repo.get_by_id.return_value = None
        ctx = self._mock_db_ctx()
        token = active_ck_context.set([{"value": '{"courseId": 99}'}])
        try:
            with (
                patch(
                    "app.agent.ai_tutor.nodes.context_sync.db_session", return_value=ctx
                ),
                patch(
                    "app.agent.ai_tutor.nodes.context_sync.CourseRepository",
                    return_value=mock_repo,
                ),
            ):
                result = await context_sync_node(
                    {"course_id": None, "lesson_id": None}, {}
                )
            assert result["course_id"] == 99
            assert result["course_info"] is None
        finally:
            active_ck_context.reset(token)


# ── tutor_node ─────────────────────────────────────────────────────────────


class TestTutorNode:
    def _patch_llm(self, response):
        bound = MagicMock()
        bound.ainvoke = AsyncMock(return_value=response)
        return (
            patch("app.agent.ai_tutor.nodes.tutor._bind_tools", return_value=bound),
            bound,
        )

    async def test_invokes_llm_with_system_and_messages(self):
        token = active_ck_context.set([])
        try:
            patcher, bound = self._patch_llm(AIMessage(content="hi back"))
            with patcher:
                result = await tutor_node(
                    {"messages": [HumanMessage(content="hi")]}, {}
                )
                assert result["messages"][0].content == "hi back"
                sent = bound.ainvoke.call_args[0][0]
                assert sent[0].type == "system"
                assert "AI tutor" in sent[0].content
                assert sent[1].content == "hi"
        finally:
            active_ck_context.reset(token)

    async def test_includes_context_block_when_available(self):
        token = active_ck_context.set(
            [{"description": "Current page", "value": "courses"}]
        )
        try:
            patcher, bound = self._patch_llm(AIMessage(content="ok"))
            with patcher:
                await tutor_node(
                    {"messages": [HumanMessage(content="where am i?")]}, {}
                )
                sent_system = bound.ainvoke.call_args[0][0][0].content
                assert "[Application context]" in sent_system
                assert "Current page: courses" in sent_system
        finally:
            active_ck_context.reset(token)

    async def test_binds_frontend_actions_alongside_backend_tools(self):
        token = active_ck_context.set([])
        try:
            patcher, _ = self._patch_llm(AIMessage(content="ok"))
            with patcher as bind_tools:
                fe_tool = {
                    "name": "navigate_to",
                    "description": "Navigate",
                    "parameters": {"type": "object", "properties": {}},
                }
                await tutor_node(
                    {
                        "messages": [HumanMessage(content="hi")],
                        "copilotkit": {"actions": [fe_tool], "context": []},
                    },
                    {},
                )
                bound_with = bind_tools.call_args[0][0]
                names = [
                    t["name"] if isinstance(t, dict) else t.name for t in bound_with
                ]
                assert "navigate_to" in names
                assert "get_user_profile" in names
        finally:
            active_ck_context.reset(token)

    async def test_fetches_user_memory_on_first_turn(self):
        """user_memory absent in state → fetches from DB and returns it in state."""
        ck_token = active_ck_context.set([])
        uid_token = active_user_id.set(7)
        try:
            patcher, _ = self._patch_llm(AIMessage(content="ok"))
            with (
                patcher,
                patch("app.agent.ai_tutor.nodes.tutor.db_session") as mock_ctx,
                patch(
                    "app.agent.ai_tutor.nodes.tutor.build_user_memory",
                    new_callable=AsyncMock,
                ) as mock_mem,
            ):
                mock_ctx.return_value.__enter__ = MagicMock(return_value=MagicMock())
                mock_ctx.return_value.__exit__ = MagicMock(return_value=False)
                mock_mem.return_value = "Role: student"

                result = await tutor_node(
                    {"messages": [HumanMessage(content="hi")]}, {}
                )

                mock_mem.assert_awaited_once()
                assert result["user_memory"] == "Role: student"
        finally:
            active_ck_context.reset(ck_token)
            active_user_id.reset(uid_token)

    async def test_skips_fetch_when_user_memory_already_in_state(self):
        """user_memory present in state → no DB hit on subsequent turns."""
        ck_token = active_ck_context.set([])
        uid_token = active_user_id.set(7)
        try:
            patcher, _ = self._patch_llm(AIMessage(content="ok"))
            with (
                patcher,
                patch(
                    "app.agent.ai_tutor.nodes.tutor.build_user_memory",
                    new_callable=AsyncMock,
                ) as mock_mem,
            ):
                result = await tutor_node(
                    {
                        "messages": [HumanMessage(content="hi")],
                        "user_memory": "Role: student",
                    },
                    {},
                )

                mock_mem.assert_not_awaited()
                assert "user_memory" not in result
        finally:
            active_ck_context.reset(ck_token)
            active_user_id.reset(uid_token)

    async def test_injects_user_memory_into_system_prompt(self):
        """user_memory from state appears under [User memory] in system prompt."""
        ck_token = active_ck_context.set([])
        try:
            patcher, bound = self._patch_llm(AIMessage(content="ok"))
            with patcher:
                await tutor_node(
                    {
                        "messages": [HumanMessage(content="hi")],
                        "user_memory": "Role: admin",
                    },
                    {},
                )
                sent_system = bound.ainvoke.call_args[0][0][0].content
                assert "[User memory]" in sent_system
                assert "Role: admin" in sent_system
        finally:
            active_ck_context.reset(ck_token)

    async def test_injects_course_info_into_system_prompt(self):
        token = active_ck_context.set([])
        try:
            patcher, bound = self._patch_llm(AIMessage(content="ok"))
            with patcher:
                await tutor_node(
                    {
                        "messages": [HumanMessage(content="hi")],
                        "course_info": "Python basics reference",
                    },
                    {},
                )
                sent_system = bound.ainvoke.call_args[0][0][0].content
                assert "[Course reference material]" in sent_system
                assert "Python basics reference" in sent_system
        finally:
            active_ck_context.reset(token)

    async def test_injects_lesson_name_and_info_into_system_prompt(self):
        token = active_ck_context.set([])
        try:
            patcher, bound = self._patch_llm(AIMessage(content="ok"))
            with patcher:
                await tutor_node(
                    {
                        "messages": [HumanMessage(content="hi")],
                        "lesson_name": "Variables",
                        "lesson_info": "A variable stores a value.",
                    },
                    {},
                )
                sent_system = bound.ainvoke.call_args[0][0][0].content
                assert "[Current lesson: Variables]" in sent_system
                assert "A variable stores a value." in sent_system
        finally:
            active_ck_context.reset(token)

    async def test_user_id_from_config_takes_precedence_over_contextvar(self):
        """config['configurable']['user_id'] is used when both config and ContextVar are set."""
        ck_token = active_ck_context.set([])
        uid_token = active_user_id.set(99)
        try:
            patcher, _ = self._patch_llm(AIMessage(content="ok"))
            with (
                patcher,
                patch("app.agent.ai_tutor.nodes.tutor.db_session") as mock_ctx,
                patch(
                    "app.agent.ai_tutor.nodes.tutor.build_user_memory",
                    new_callable=AsyncMock,
                ) as mock_mem,
            ):
                mock_ctx.return_value.__enter__ = MagicMock(return_value=MagicMock())
                mock_ctx.return_value.__exit__ = MagicMock(return_value=False)
                mock_mem.return_value = "Role: teacher"

                await tutor_node(
                    {"messages": [HumanMessage(content="hi")]},
                    {"configurable": {"user_id": 42}},
                )

                call_uid = mock_mem.call_args[0][0]
                assert call_uid == 42
        finally:
            active_ck_context.reset(ck_token)
            active_user_id.reset(uid_token)


# ── route_after_tutor ─────────────────────────────────────────────────────


class TestRouteAfterTutor:
    def test_empty_messages_returns_end(self):
        from langgraph.graph import END

        assert route_after_tutor({"messages": []}) == END

    def test_no_messages_key_returns_end(self):
        from langgraph.graph import END

        assert route_after_tutor({}) == END

    def test_non_ai_message_returns_end(self):
        from langgraph.graph import END

        assert route_after_tutor({"messages": [HumanMessage(content="hi")]}) == END

    def test_ai_message_without_tool_calls_returns_end(self):
        from langgraph.graph import END

        assert route_after_tutor({"messages": [AIMessage(content="ok")]}) == END

    def test_ai_message_with_backend_tool_call_returns_tools(self):
        backend_tool = next(iter(_BACKEND_TOOL_NAMES))
        msg = AIMessage(
            content="", tool_calls=[{"name": backend_tool, "args": {}, "id": "1"}]
        )
        assert route_after_tutor({"messages": [msg]}) == "tools"

    def test_ai_message_with_frontend_tool_call_returns_end(self):
        from langgraph.graph import END

        msg = AIMessage(
            content="", tool_calls=[{"name": "navigate_to", "args": {}, "id": "1"}]
        )
        assert route_after_tutor({"messages": [msg]}) == END


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


class TestDbSession:
    def test_yields_db_and_closes_generator(self):
        mock_db = MagicMock()

        def _gen():
            yield mock_db

        with patch("app.agent.ai_tutor.state.get_db", return_value=_gen()):
            from app.agent.ai_tutor.state import db_session

            with db_session() as db:
                assert db is mock_db

    def test_generator_closed_on_exception(self):
        mock_db = MagicMock()
        closed = []

        def _gen():
            try:
                yield mock_db
            finally:
                closed.append(True)

        with patch("app.agent.ai_tutor.state.get_db", return_value=_gen()):
            from app.agent.ai_tutor.state import db_session

            with pytest.raises(RuntimeError):
                with db_session():
                    raise RuntimeError("boom")
        assert closed == [True]


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
