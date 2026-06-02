"""Unit tests for NodeService — repository is fully mocked."""

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.node_service import NodeService


def _make_node(id: str, type: str = "component", label: str = "X",
               parent_id: str | None = None, linked: list[str] | None = None):
    n = MagicMock()
    n.id = id
    n.type = type
    n.label = label
    n.parent_id = parent_id
    n.linked_node_ids = linked or []
    n.default_x = 0.0
    n.default_y = 0.0
    n.default_w = None
    return n


def _make_service(repo=None) -> NodeService:
    return NodeService(repository=repo or AsyncMock())


class TestGetPlacement:
    def test_not_found_raises(self):
        repo = AsyncMock()
        repo.get_by_id.return_value = None
        with pytest.raises(ValueError, match="not found"):
            asyncio.run(_make_service(repo).get_placement("missing"))

    def test_single_node_returned(self):
        repo = AsyncMock()
        repo.get_by_id.return_value = _make_node("n1")
        repo.get_many.return_value = []
        repo.get_children_of.return_value = []
        result = asyncio.run(_make_service(repo).get_placement("n1"))
        assert len(result.nodes) == 1
        assert result.nodes[0].id == "n1"

    def test_linked_nodes_included(self):
        root = _make_node("root", linked=["child"])
        child = _make_node("child")
        repo = AsyncMock()
        repo.get_by_id.return_value = root
        repo.get_many.side_effect = lambda ids: [child] if "child" in ids else []
        repo.get_children_of.return_value = []
        result = asyncio.run(_make_service(repo).get_placement("root"))
        ids = {n.id for n in result.nodes}
        assert ids == {"root", "child"}

    def test_service_modules_included(self):
        svc = _make_node("svc", type="service")
        module = _make_node("mod", type="module", parent_id="svc")
        repo = AsyncMock()
        repo.get_by_id.return_value = svc
        repo.get_many.return_value = []
        repo.get_children_of.side_effect = lambda pid: [module] if pid == "svc" else []
        result = asyncio.run(_make_service(repo).get_placement("svc"))
        ids = {n.id for n in result.nodes}
        assert ids == {"svc", "mod"}

    def test_no_duplicate_nodes(self):
        root = _make_node("root", type="service", linked=["other"])
        other = _make_node("other")
        repo = AsyncMock()
        repo.get_by_id.return_value = root
        repo.get_many.side_effect = lambda ids: [other] if "other" in ids else []
        repo.get_children_of.return_value = []
        result = asyncio.run(_make_service(repo).get_placement("root"))
        assert len(result.nodes) == len({n.id for n in result.nodes})
