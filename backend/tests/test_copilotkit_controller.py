"""Tests for the CopilotKit remote endpoint at POST /api/v1/copilotkit."""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from jose import jwt

from app.core.config import settings
from app.main import app


client = TestClient(app, raise_server_exceptions=False)


def _make_access_token() -> str:
    payload = {
        "sub": "1",
        "email": "test@example.com",
        "exp": datetime.now(timezone.utc) + timedelta(minutes=15),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


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
