"""Tests for health controller, service, and repository."""
from unittest.mock import MagicMock

from fastapi.testclient import TestClient

from app.dependencies.health import get_health_service
from app.main import app
from app.repositories.health_repository import HealthRepository
from app.schemas.health import HealthPayload
from app.services.health_service import HealthService

client = TestClient(app)


# ── HealthService ──────────────────────────────────────────────────────────

class TestHealthService:
    def test_get_health_status_returns_response(self):
        svc = HealthService(repository=HealthRepository())
        result = svc.get_health_status()
        assert result.status == "ok"
        assert result.service == "backend"


# ── GET /api/v1/health ─────────────────────────────────────────────────────

class TestHealthController:
    def test_returns_200_with_status(self):
        mock_svc = MagicMock()
        mock_svc.get_health_status.return_value = HealthPayload(status="ok", service="backend")
        app.dependency_overrides[get_health_service] = lambda: mock_svc
        try:
            response = client.get("/api/v1/health")
            assert response.status_code == 200
            assert response.json()["status"] == "ok"
        finally:
            app.dependency_overrides.pop(get_health_service, None)
