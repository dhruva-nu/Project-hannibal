"""Tests for /nodes endpoints."""

from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from app.dependencies.node import get_node_service
from app.main import app
from app.schemas.node import NodePlacementResponse, NodeResponse
from app.services.node_service import NodeService

client = TestClient(app, raise_server_exceptions=False)

_SERVICE_NODE = NodeResponse(
    id="svc-1",
    type="service",
    label="Backend",
    parent_id=None,
    linked_node_ids=[],
    default_x=100.0,
    default_y=120.0,
    default_w=240.0,
)

_MODULE_NODE = NodeResponse(
    id="mod-1",
    type="module",
    label="Auth Module",
    parent_id="svc-1",
    linked_node_ids=[],
    default_x=None,
    default_y=None,
    default_w=None,
)

_COMPONENT_NODE = NodeResponse(
    id="cmp-1",
    type="component",
    label="Client",
    parent_id=None,
    linked_node_ids=[],
    default_x=20.0,
    default_y=40.0,
    default_w=None,
)


@pytest.fixture(autouse=True)
def clear_overrides():
    yield
    app.dependency_overrides.clear()


def _mock_service(**kwargs):
    mock = MagicMock(spec=NodeService)
    for method, value in kwargs.items():
        if isinstance(value, Exception):
            setattr(mock, method, AsyncMock(side_effect=value))
        else:
            setattr(mock, method, AsyncMock(return_value=value))
    app.dependency_overrides[get_node_service] = lambda: mock
    return mock


class TestGetNodePlacement:
    def test_component_returns_200(self):
        _mock_service(get_placement=NodePlacementResponse(nodes=[_COMPONENT_NODE]))
        resp = client.get("/api/v1/nodes/cmp-1/placement")
        assert resp.status_code == 200
        body = resp.json()
        assert [n["id"] for n in body["nodes"]] == ["cmp-1"]

    def test_service_with_children_and_linked(self):
        _mock_service(
            get_placement=NodePlacementResponse(
                nodes=[_SERVICE_NODE, _MODULE_NODE, _COMPONENT_NODE]
            )
        )
        resp = client.get("/api/v1/nodes/svc-1/placement")
        assert resp.status_code == 200
        ids = [n["id"] for n in resp.json()["nodes"]]
        assert ids == ["svc-1", "mod-1", "cmp-1"]

    def test_module_returns_module_with_parent(self):
        _mock_service(
            get_placement=NodePlacementResponse(nodes=[_MODULE_NODE, _SERVICE_NODE])
        )
        resp = client.get("/api/v1/nodes/mod-1/placement")
        assert resp.status_code == 200
        body = resp.json()
        assert body["nodes"][0]["id"] == "mod-1"
        assert body["nodes"][0]["parent_id"] == "svc-1"
        assert body["nodes"][1]["id"] == "svc-1"

    def test_unknown_id_returns_404(self):
        _mock_service(get_placement=ValueError("not found"))
        resp = client.get("/api/v1/nodes/missing/placement")
        assert resp.status_code == 404
        assert "missing" in resp.json()["detail"]

    def test_runtime_error_returns_500(self):
        _mock_service(get_placement=RuntimeError("db down"))
        resp = client.get("/api/v1/nodes/svc-1/placement")
        assert resp.status_code == 500
