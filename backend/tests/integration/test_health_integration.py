"""Integration tests for /api/v1/health.

HealthService uses HealthRepository which has no DB dependency,
so no mock_db is needed — this is a pure end-to-end test.
"""


class TestHealthIntegration:
    def test_health_check_returns_200(self, client):
        resp = client.get("/api/v1/health")
        assert resp.status_code == 200

    def test_health_response_has_ok_status(self, client):
        resp = client.get("/api/v1/health")
        assert resp.json()["status"] == "ok"

    def test_health_response_has_backend_service(self, client):
        resp = client.get("/api/v1/health")
        assert resp.json()["service"] == "backend"
