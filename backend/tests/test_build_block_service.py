"""Unit tests for BuildBlockService — repository is fully mocked."""
import asyncio
import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.build_block_service import BuildBlockService

_UUID = uuid.UUID("12345678-1234-5678-1234-567812345678")

_DEFAULTS = dict(
    id=_UUID,
    instructions="Do X",
    input="in",
    output="out",
    test_code="assert True",
    code_template="def f(): pass",
)


def _make_block(**overrides):
    attrs = {**_DEFAULTS, **overrides}
    b = MagicMock()
    for k, v in attrs.items():
        setattr(b, k, v)
    return b


def _make_service(repo=None) -> BuildBlockService:
    return BuildBlockService(repository=repo or AsyncMock())


class TestListBlocks:
    def test_returns_all_blocks(self):
        repo = AsyncMock()
        repo.get_all.return_value = [_make_block(), _make_block(instructions="Do Y")]
        result = asyncio.run(_make_service(repo).list_blocks())
        assert len(result) == 2
        assert result[0].instructions == "Do X"

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

    def test_not_found_raises(self):
        repo = AsyncMock()
        repo.get_by_id.return_value = None
        with pytest.raises(ValueError, match="not found"):
            asyncio.run(_make_service(repo).get_block(_UUID))


class TestCreateBlock:
    def test_creates_and_returns_response(self):
        repo = AsyncMock()
        repo.create.return_value = _make_block()
        result = asyncio.run(_make_service(repo).create_block(
            instructions="Do X",
            input="in",
            output="out",
            test_code="assert True",
            code_template="def f(): pass",
            id=_UUID,
        ))
        repo.create.assert_called_once_with(
            instructions="Do X",
            input="in",
            output="out",
            test_code="assert True",
            code_template="def f(): pass",
            id=_UUID,
        )
        assert result.instructions == "Do X"

    def test_create_without_id(self):
        repo = AsyncMock()
        repo.create.return_value = _make_block()
        asyncio.run(_make_service(repo).create_block(
            instructions="x", input="i", output="o", test_code="t", code_template="c"
        ))
        call_kwargs = repo.create.call_args.kwargs
        assert call_kwargs["id"] is None


class TestUpdateBlock:
    def test_updates_and_returns_response(self):
        repo = AsyncMock()
        repo.get_by_id.return_value = _make_block()
        repo.update.return_value = _make_block(instructions="Updated")
        result = asyncio.run(_make_service(repo).update_block(_UUID, instructions="Updated"))
        repo.update.assert_called_once()
        assert result.instructions == "Updated"

    def test_not_found_raises(self):
        repo = AsyncMock()
        repo.get_by_id.return_value = None
        with pytest.raises(ValueError, match="not found"):
            asyncio.run(_make_service(repo).update_block(_UUID, instructions="x"))


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
