"""Tests for the CopilotKit remote endpoint at POST /api/v1/copilotkit."""
import asyncio
import inspect
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from jose import jwt

from app.core.config import settings
from app.main import app
from app.api.v1.controllers.copilotkit_controller import (
    GoogleADKAgent,
    _copilotkit_messages_to_genai,
    _current_thread_id,
    _session_tasks,
    _stream_adk,
    _update_tasks_impl as update_tasks,
    get_user_profile,
)


client = TestClient(app, raise_server_exceptions=False)


def _make_access_token() -> str:
    payload = {
        "sub": "1",
        "email": "test@example.com",
        "exp": datetime.now(timezone.utc) + timedelta(minutes=15),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


# ── HTTP endpoint tests ────────────────────────────────────────────────────

class TestCopilotKitInfoEndpoint:
    def test_get_info_returns_200(self, mocker):
        mock_result = {"sdkVersion": "test", "actions": [], "agents": []}
        mocker.patch(
            "app.api.v1.controllers.copilotkit_controller.sdk.info",
            return_value=mock_result,
        )
        response = client.get("/api/v1/copilotkit/")
        assert response.status_code == 200

    def test_post_info_returns_200(self, mocker):
        mock_result = {"sdkVersion": "test", "actions": [], "agents": []}
        mocker.patch(
            "app.api.v1.controllers.copilotkit_controller.sdk.info",
            return_value=mock_result,
        )
        token = _make_access_token()
        response = client.post(
            "/api/v1/copilotkit/",
            json={},
            cookies={"access_token": token},
        )
        assert response.status_code == 200

    def test_get_without_trailing_slash_returns_200(self, mocker):
        mock_result = {"sdkVersion": "test", "actions": [], "agents": []}
        mocker.patch(
            "app.api.v1.controllers.copilotkit_controller.sdk.info",
            return_value=mock_result,
        )
        response = client.get("/api/v1/copilotkit")
        assert response.status_code == 200

    def test_post_without_auth_returns_401(self):
        response = client.post("/api/v1/copilotkit/nonexistent", json={})
        assert response.status_code == 401

    def test_post_with_invalid_token_returns_401(self):
        response = client.post(
            "/api/v1/copilotkit/nonexistent",
            json={},
            cookies={"access_token": "not-a-valid-token"},
        )
        assert response.status_code == 401

    def test_get_info_explicit_endpoint(self):
        response = client.get("/api/v1/copilotkit/info")
        assert response.status_code == 200
        data = response.json()
        assert "agents" in data
        assert "version" in data

    def test_post_info_explicit_endpoint(self):
        token = _make_access_token()
        response = client.post(
            "/api/v1/copilotkit/info",
            cookies={"access_token": token},
        )
        assert response.status_code == 200
        data = response.json()
        assert "agents" in data


# ── get_user_profile tool ──────────────────────────────────────────────────

class TestGetUserProfileTool:
    def test_found_returns_profile_string(self):
        mock_user = MagicMock()
        mock_user.id = 42
        mock_user.email = "alice@example.com"
        mock_user.provider = "google"
        mock_user.created_at.date.return_value = "2024-01-01"

        with patch("app.api.v1.controllers.copilotkit_controller.SessionLocal") as mock_sl, \
             patch("app.api.v1.controllers.copilotkit_controller.UserRepository") as mock_repo_cls:
            mock_db = MagicMock()
            mock_sl.return_value = mock_db
            mock_repo = MagicMock()
            mock_repo.get_by_email.return_value = mock_user
            mock_repo_cls.return_value = mock_repo

            result = get_user_profile("alice@example.com")

        assert "alice@example.com" in result
        assert "42" in result
        assert "google" in result
        mock_db.close.assert_called_once()

    def test_not_found_returns_message(self):
        with patch("app.api.v1.controllers.copilotkit_controller.SessionLocal") as mock_sl, \
             patch("app.api.v1.controllers.copilotkit_controller.UserRepository") as mock_repo_cls:
            mock_db = MagicMock()
            mock_sl.return_value = mock_db
            mock_repo = MagicMock()
            mock_repo.get_by_email.return_value = None
            mock_repo_cls.return_value = mock_repo

            result = get_user_profile("ghost@example.com")

        assert "No user found" in result
        assert "ghost@example.com" in result
        mock_db.close.assert_called_once()

    def test_db_always_closed_on_exception(self):
        with patch("app.api.v1.controllers.copilotkit_controller.SessionLocal") as mock_sl, \
             patch("app.api.v1.controllers.copilotkit_controller.UserRepository") as mock_repo_cls:
            mock_db = MagicMock()
            mock_sl.return_value = mock_db
            mock_repo = MagicMock()
            mock_repo.get_by_email.side_effect = RuntimeError("db down")
            mock_repo_cls.return_value = mock_repo

            with pytest.raises(RuntimeError):
                get_user_profile("x@example.com")

        mock_db.close.assert_called_once()


# ── update_tasks tool ──────────────────────────────────────────────────────

class TestUpdateTasksTool:
    def setup_method(self):
        _session_tasks.clear()

    def test_stores_tasks_for_current_thread(self):
        token = _current_thread_id.set("thread-abc")
        try:
            result = update_tasks([
                {"title": "Task 1", "status": "todo"},
                {"title": "Task 2", "status": "done"},
            ])
        finally:
            _current_thread_id.reset(token)

        assert result == {"updated": True, "count": 2}
        assert _session_tasks["thread-abc"] == [
            {"title": "Task 1", "status": "todo"},
            {"title": "Task 2", "status": "done"},
        ]

    def test_defaults_missing_status_to_todo(self):
        token = _current_thread_id.set("thread-def")
        try:
            update_tasks([{"title": "No status task"}])
        finally:
            _current_thread_id.reset(token)

        assert _session_tasks["thread-def"][0]["status"] == "todo"

    def test_empty_list_clears_tasks(self):
        _session_tasks["thread-ghi"] = [{"title": "old", "status": "todo"}]
        token = _current_thread_id.set("thread-ghi")
        try:
            result = update_tasks([])
        finally:
            _current_thread_id.reset(token)

        assert result["count"] == 0
        assert _session_tasks["thread-ghi"] == []

    def test_no_thread_id_does_not_store(self):
        token = _current_thread_id.set("")
        try:
            update_tasks([{"title": "Ghost task", "status": "todo"}])
        finally:
            _current_thread_id.reset(token)

        assert "" not in _session_tasks


# ── GoogleADKAgent.get_state ───────────────────────────────────────────────

class TestGoogleADKAgentGetState:
    def setup_method(self):
        _session_tasks.clear()

    def test_returns_empty_tasks_when_none_set(self):
        agent = GoogleADKAgent()
        state = asyncio.run(agent.get_state(thread_id="new-thread"))
        assert state["state"] == {"tasks": []}
        assert state["threadId"] == "new-thread"

    def test_returns_stored_tasks(self):
        _session_tasks["known-thread"] = [{"title": "T1", "status": "done"}]
        agent = GoogleADKAgent()
        state = asyncio.run(agent.get_state(thread_id="known-thread"))
        assert state["state"]["tasks"] == [{"title": "T1", "status": "done"}]


# ── GoogleADKAgent.execute ─────────────────────────────────────────────────

class TestGoogleADKAgentExecute:
    def test_execute_returns_async_generator(self):
        agent = GoogleADKAgent()
        result = agent.execute(
            state={},
            messages=[{"role": "user", "content": "hi"}],
            thread_id="t1",
        )
        assert inspect.isasyncgen(result)


# ── _copilotkit_messages_to_genai ──────────────────────────────────────────

class TestCopilotKitMessagesToGenai:
    def test_returns_content_for_last_user_message(self):
        messages = [
            {"role": "assistant", "content": "Hello"},
            {"role": "user", "content": "What is Redis?"},
        ]
        result = _copilotkit_messages_to_genai(messages)
        assert result is not None
        assert result.parts[0].text == "What is Redis?"

    def test_returns_none_for_empty_messages(self):
        assert _copilotkit_messages_to_genai([]) is None

    def test_returns_none_when_no_user_message(self):
        messages = [{"role": "assistant", "content": "Hi there"}]
        assert _copilotkit_messages_to_genai(messages) is None

    def test_returns_none_for_user_message_with_empty_content(self):
        messages = [{"role": "user", "content": ""}]
        assert _copilotkit_messages_to_genai(messages) is None

    def test_picks_last_user_message(self):
        messages = [
            {"role": "user", "content": "first"},
            {"role": "user", "content": "last"},
        ]
        result = _copilotkit_messages_to_genai(messages)
        assert result.parts[0].text == "last"


# ── _stream_adk ────────────────────────────────────────────────────────────

async def _collect(gen):
    chunks = []
    async for chunk in gen:
        chunks.append(chunk)
    return chunks


def _make_text_event(text: str):
    part = MagicMock()
    part.text = text
    event = MagicMock()
    event.content = MagicMock()
    event.content.parts = [part]
    return event


def _make_empty_event():
    event = MagicMock()
    event.content = None
    return event


class TestStreamAdk:
    def setup_method(self):
        _session_tasks.clear()

    def test_no_user_message_emits_run_start_and_finish(self):
        chunks = asyncio.run(_collect(_stream_adk(messages=[], thread_id="tid-empty")))
        combined = "".join(chunks)
        assert "RUN_STARTED" in combined
        assert "RUN_FINISHED" in combined
        assert "STATE_SNAPSHOT" in combined
        assert "TEXT_MESSAGE_START" not in combined

    def test_user_message_with_text_response_emits_all_events(self):
        async def mock_run(*args, **kwargs):
            yield _make_text_event("Hello!")

        with patch("app.api.v1.controllers.copilotkit_controller._session_service") as mock_ss, \
             patch("app.api.v1.controllers.copilotkit_controller._runner") as mock_runner:
            mock_ss.get_session = AsyncMock(return_value=None)
            mock_ss.create_session = AsyncMock()
            mock_runner.run_async = mock_run

            msgs = [{"role": "user", "content": "Tell me about Redis"}]
            chunks = asyncio.run(_collect(_stream_adk(messages=msgs, thread_id="tid-text")))

        combined = "".join(chunks)
        assert "RUN_STARTED" in combined
        assert "TEXT_MESSAGE_START" in combined
        assert "TEXT_MESSAGE_CONTENT" in combined
        assert "TEXT_MESSAGE_END" in combined
        assert "STATE_SNAPSHOT" in combined
        assert "RUN_FINISHED" in combined

    def test_existing_session_skips_create(self):
        async def mock_run(*args, **kwargs):
            yield _make_text_event("hi")

        with patch("app.api.v1.controllers.copilotkit_controller._session_service") as mock_ss, \
             patch("app.api.v1.controllers.copilotkit_controller._runner") as mock_runner:
            mock_ss.get_session = AsyncMock(return_value=MagicMock())  # session exists
            mock_ss.create_session = AsyncMock()
            mock_runner.run_async = mock_run

            asyncio.run(_collect(_stream_adk(
                messages=[{"role": "user", "content": "hi"}],
                thread_id="tid-existing",
            )))

        mock_ss.create_session.assert_not_called()

    def test_event_with_no_content_is_skipped(self):
        async def mock_run(*args, **kwargs):
            yield _make_empty_event()
            yield _make_text_event("After empty")

        with patch("app.api.v1.controllers.copilotkit_controller._session_service") as mock_ss, \
             patch("app.api.v1.controllers.copilotkit_controller._runner") as mock_runner:
            mock_ss.get_session = AsyncMock(return_value=None)
            mock_ss.create_session = AsyncMock()
            mock_runner.run_async = mock_run

            chunks = asyncio.run(_collect(_stream_adk(
                messages=[{"role": "user", "content": "hi"}],
                thread_id="tid-skip",
            )))

        combined = "".join(chunks)
        assert "TEXT_MESSAGE_START" in combined

    def test_event_with_no_text_part_is_skipped(self):
        part = MagicMock()
        part.text = None
        event = MagicMock()
        event.content = MagicMock()
        event.content.parts = [part]

        async def mock_run(*args, **kwargs):
            yield event

        with patch("app.api.v1.controllers.copilotkit_controller._session_service") as mock_ss, \
             patch("app.api.v1.controllers.copilotkit_controller._runner") as mock_runner:
            mock_ss.get_session = AsyncMock(return_value=None)
            mock_ss.create_session = AsyncMock()
            mock_runner.run_async = mock_run

            chunks = asyncio.run(_collect(_stream_adk(
                messages=[{"role": "user", "content": "hi"}],
                thread_id="tid-notext",
            )))

        combined = "".join(chunks)
        assert "TEXT_MESSAGE_START" not in combined
        assert "RUN_FINISHED" in combined

    def test_state_snapshot_includes_stored_tasks(self):
        _session_tasks["tid-tasks"] = [{"title": "T1", "status": "todo"}]

        async def mock_run(*args, **kwargs):
            yield _make_text_event("done")

        with patch("app.api.v1.controllers.copilotkit_controller._session_service") as mock_ss, \
             patch("app.api.v1.controllers.copilotkit_controller._runner") as mock_runner:
            mock_ss.get_session = AsyncMock(return_value=None)
            mock_ss.create_session = AsyncMock()
            mock_runner.run_async = mock_run

            chunks = asyncio.run(_collect(_stream_adk(
                messages=[{"role": "user", "content": "go"}],
                thread_id="tid-tasks",
            )))

        combined = "".join(chunks)
        assert "T1" in combined
