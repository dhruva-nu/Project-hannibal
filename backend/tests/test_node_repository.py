"""Unit tests for NodeRepository and node dependency — Beanie is mocked at the class level."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.dependencies.node import get_node_service
from app.repositories.node_repository import NodeRepository
from app.services.node_service import NodeService


def _make_node(id: str):
    n = MagicMock()
    n.id = id
    return n


class TestGetNodeServiceDependency:
    def test_returns_node_service(self):
        svc = get_node_service()
        assert isinstance(svc, NodeService)


class TestNodeRepository:
    @pytest.mark.asyncio
    async def test_get_by_id_delegates_to_beanie(self):
        node = _make_node("abc")
        with patch(
            "app.repositories.node_repository.Node.find_one",
            new=AsyncMock(return_value=node),
        ):
            repo = NodeRepository()
            result = await repo.get_by_id("abc")
            assert result is node

    @pytest.mark.asyncio
    async def test_get_children_of_delegates_to_beanie(self):
        children = [_make_node("c1"), _make_node("c2")]
        find_mock = MagicMock()
        find_mock.to_list = AsyncMock(return_value=children)
        with patch(
            "app.repositories.node_repository.Node.find",
            return_value=find_mock,
        ):
            repo = NodeRepository()
            result = await repo.get_children_of("parent-id")
            assert result == children

    @pytest.mark.asyncio
    async def test_get_many_delegates_to_beanie(self):
        nodes = [_make_node("n1"), _make_node("n2")]
        find_mock = MagicMock()
        find_mock.to_list = AsyncMock(return_value=nodes)
        with patch(
            "app.repositories.node_repository.Node.find",
            return_value=find_mock,
        ):
            repo = NodeRepository()
            result = await repo.get_many(["n1", "n2"])
            assert result == nodes
