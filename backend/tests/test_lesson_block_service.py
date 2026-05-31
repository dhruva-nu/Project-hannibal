"""Unit tests for LessonBlockService — repository is fully mocked."""

import asyncio
import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.lesson_block_service import LessonBlockService

_UUID = uuid.UUID("12345678-1234-5678-1234-567812345678")


def _make_block(**overrides):
    attrs = {"id": _UUID, "content": "hello", "summary": "world"}
    attrs.update(overrides)
    b = MagicMock()
    for k, v in attrs.items():
        setattr(b, k, v)
    return b


def _make_service(repo=None) -> LessonBlockService:
    return LessonBlockService(repository=repo or AsyncMock())


class TestListBlocks:
    def test_returns_all_blocks(self):
        repo = AsyncMock()
        repo.get_all.return_value = [_make_block(), _make_block(content="second")]
        result = asyncio.run(_make_service(repo).list_blocks())
        assert len(result) == 2
        assert result[0].content == "hello"

    def test_empty_list(self):
        repo = AsyncMock()
        repo.get_all.return_value = []
        result = asyncio.run(_make_service(repo).list_blocks())
        assert result == []


class TestGetBlock:
    def test_found_returns_response(self):
        repo = AsyncMock()
        repo.get_by_id.return_value = _make_block()
        result = asyncio.run(_make_service(repo).get_block(_UUID))
        assert result.id == _UUID
        assert result.content == "hello"

    def test_not_found_raises(self):
        repo = AsyncMock()
        repo.get_by_id.return_value = None
        with pytest.raises(ValueError, match="not found"):
            asyncio.run(_make_service(repo).get_block(_UUID))


class TestCreateBlock:
    def test_creates_and_returns_response(self):
        repo = AsyncMock()
        repo.create.return_value = _make_block()
        result = asyncio.run(
            _make_service(repo).create_block(content="hello", summary="world", id=_UUID)
        )
        repo.create.assert_called_once_with(content="hello", summary="world", id=_UUID)
        assert result.content == "hello"

    def test_create_without_id(self):
        repo = AsyncMock()
        repo.create.return_value = _make_block()
        asyncio.run(_make_service(repo).create_block(content="x", summary="y"))
        repo.create.assert_called_once_with(content="x", summary="y", id=None)


class TestUpdateBlock:
    def test_updates_and_returns_response(self):
        repo = AsyncMock()
        repo.get_by_id.return_value = _make_block()
        repo.update.return_value = _make_block(content="updated")
        result = asyncio.run(_make_service(repo).update_block(_UUID, content="updated"))
        repo.update.assert_called_once()
        assert result.content == "updated"

    def test_not_found_raises(self):
        repo = AsyncMock()
        repo.get_by_id.return_value = None
        with pytest.raises(ValueError, match="not found"):
            asyncio.run(_make_service(repo).update_block(_UUID, content="x"))


class TestDeleteBlock:
    def test_deletes_existing_block(self):
        repo = AsyncMock()
        repo.get_by_id.return_value = _make_block()
        asyncio.run(_make_service(repo).delete_block(_UUID))
        repo.delete.assert_called_once()

    def test_not_found_raises(self):
        repo = AsyncMock()
        repo.get_by_id.return_value = None
        with pytest.raises(ValueError, match="not found"):
            asyncio.run(_make_service(repo).delete_block(_UUID))
