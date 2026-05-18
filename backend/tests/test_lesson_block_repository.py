"""Unit tests for LessonBlockRepository — Beanie model is fully mocked."""
import asyncio
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

from app.repositories.lesson_block_repository import LessonBlockRepository

_UUID = uuid.UUID("12345678-1234-5678-1234-567812345678")
_MODULE = "app.repositories.lesson_block_repository.LessonBlock"


class TestGetAll:
    def test_returns_list_of_blocks(self):
        async def run():
            mock_block = MagicMock()
            with patch(_MODULE) as MockBlock:
                mock_query = MagicMock()
                mock_query.to_list = AsyncMock(return_value=[mock_block])
                MockBlock.find_all.return_value = mock_query
                result = await LessonBlockRepository().get_all()
            assert result == [mock_block]
            MockBlock.find_all.assert_called_once()

        asyncio.run(run())

    def test_empty_collection_returns_empty_list(self):
        async def run():
            with patch(_MODULE) as MockBlock:
                mock_query = MagicMock()
                mock_query.to_list = AsyncMock(return_value=[])
                MockBlock.find_all.return_value = mock_query
                result = await LessonBlockRepository().get_all()
            assert result == []

        asyncio.run(run())


class TestGetById:
    def test_found_returns_block(self):
        async def run():
            mock_block = MagicMock()
            with patch(_MODULE) as MockBlock:
                MockBlock.id = MagicMock()
                MockBlock.find_one = AsyncMock(return_value=mock_block)
                result = await LessonBlockRepository().get_by_id(_UUID)
            assert result is mock_block

        asyncio.run(run())

    def test_not_found_returns_none(self):
        async def run():
            with patch(_MODULE) as MockBlock:
                MockBlock.id = MagicMock()
                MockBlock.find_one = AsyncMock(return_value=None)
                result = await LessonBlockRepository().get_by_id(_UUID)
            assert result is None

        asyncio.run(run())


class TestCreate:
    def test_inserts_and_returns_block(self):
        async def run():
            with patch(_MODULE) as MockBlock:
                mock_block = MagicMock()
                mock_block.insert = AsyncMock()
                MockBlock.return_value = mock_block
                result = await LessonBlockRepository().create(content="hello", summary="world", id=_UUID)
            MockBlock.assert_called_once_with(id=_UUID, content="hello", summary="world")
            mock_block.insert.assert_called_once()
            assert result is mock_block

        asyncio.run(run())

    def test_generates_uuid_when_id_is_none(self):
        async def run():
            with patch(_MODULE) as MockBlock:
                mock_block = MagicMock()
                mock_block.insert = AsyncMock()
                MockBlock.return_value = mock_block
                await LessonBlockRepository().create(content="x", summary="y", id=None)
            call_kwargs = MockBlock.call_args.kwargs
            assert call_kwargs["id"] is not None

        asyncio.run(run())


class TestUpdate:
    def test_calls_set_and_returns_block(self):
        async def run():
            block = MagicMock()
            block.set = AsyncMock()
            result = await LessonBlockRepository().update(block, content="updated")
            block.set.assert_called_once_with({"content": "updated"})
            assert result is block

        asyncio.run(run())


class TestDelete:
    def test_calls_delete_on_block(self):
        async def run():
            block = MagicMock()
            block.delete = AsyncMock()
            await LessonBlockRepository().delete(block)
            block.delete.assert_called_once()

        asyncio.run(run())
