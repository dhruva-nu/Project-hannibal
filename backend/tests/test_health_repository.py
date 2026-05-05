from app.repositories.base import Repository
from app.repositories.health_repository import HealthRepository


def test_repository_protocol_is_importable():
    assert Repository is not None


class TestHealthRepository:
    def test_get_returns_ok_payload(self):
        result = HealthRepository().get()
        assert result.status == "ok"
        assert result.service == "backend"
