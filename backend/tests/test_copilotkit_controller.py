"""Tests for the CopilotKit remote endpoint at POST /api/v1/copilotkit."""
import pytest
from fastapi.testclient import TestClient
from unittest.mock import MagicMock, patch

from app.main import app


client = TestClient(app, raise_server_exceptions=False)


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
        response = client.post("/api/v1/copilotkit/", json={})
        assert response.status_code == 200

    def test_get_without_trailing_slash_returns_200(self, mocker):
        mock_result = {"sdkVersion": "test", "actions": [], "agents": []}
        mocker.patch(
            "app.api.v1.controllers.copilotkit_controller.sdk.info",
            return_value=mock_result,
        )
        response = client.get("/api/v1/copilotkit")
        assert response.status_code == 200

    def test_unknown_path_returns_404(self, mocker):
        response = client.post("/api/v1/copilotkit/nonexistent", json={})
        assert response.status_code == 404
