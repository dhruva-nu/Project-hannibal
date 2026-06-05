"""Tests for /nodes endpoints."""

import pytest
from fastapi.testclient import TestClient

from app.dependencies.node import get_node_service
from app.main import app
from app.schemas.node import NodePlacementResponse
from app.services.node_service import NodeService

client = TestClient(app, raise_server_exceptions=False)

_PLACEMENT = NodePlacementResponse(nodes=[])


def _mock_service(mocker, **kwargs):
    mock = mocker.AsyncMock(spec=NodeService)
    for method, value in kwargs.items():
        if isinstance(value, Exception):
            getattr(mock, method).side_effect = value
        else:
            getattr(mock, method).return_value = value
    app.dependency_overrides[get_node_service] = lambda: mock
    return mock


@pytest.fixture(autouse=True)
def clear_overrides():
    yield
    app.dependency_overrides.clear()


class TestGetNodePlacement:
    def test_returns_200(self, mocker):
        _mock_service(mocker, get_placement=_PLACEMENT)
        resp = client.get("/api/v1/nodes/some-uuid/placement")
        assert resp.status_code == 200

    def test_not_found_returns_404(self, mocker):
        _mock_service(mocker, get_placement=ValueError("node not found"))
        resp = client.get("/api/v1/nodes/missing-id/placement")
        assert resp.status_code == 404

    def test_unexpected_error_returns_500(self, mocker):
        _mock_service(mocker, get_placement=RuntimeError("mongo down"))
        resp = client.get("/api/v1/nodes/some-uuid/placement")
        assert resp.status_code == 500
