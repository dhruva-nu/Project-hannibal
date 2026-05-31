"""Unit tests for TagsService — repository is fully mocked."""

from unittest.mock import MagicMock

import pytest

from app.models.tags_model import Tags
from app.services.tags_service import TagsService


def _make_tag(
    id: int = 1, name: str = "python", description: str = "Python lang"
) -> Tags:
    tag = Tags()
    tag.id = id
    tag.name = name
    tag.description = description
    return tag


def _make_service(repo=None) -> TagsService:
    return TagsService(repository=repo or MagicMock())


class TestListTags:
    def test_returns_all_tags(self):
        repo = MagicMock()
        repo.get_all.return_value = [_make_tag(1), _make_tag(2, "js", "JavaScript")]
        svc = _make_service(repo)

        result = svc.list_tags()

        assert len(result) == 2
        assert result[0].name == "python"

    def test_empty_list(self):
        repo = MagicMock()
        repo.get_all.return_value = []
        svc = _make_service(repo)

        assert svc.list_tags() == []


class TestGetTag:
    def test_found_returns_response(self):
        repo = MagicMock()
        repo.get_by_id.return_value = _make_tag()
        svc = _make_service(repo)

        result = svc.get_tag(1)

        assert result.id == 1
        assert result.name == "python"

    def test_not_found_raises(self):
        repo = MagicMock()
        repo.get_by_id.return_value = None
        svc = _make_service(repo)

        with pytest.raises(ValueError, match="not found"):
            svc.get_tag(99)


class TestCreateTag:
    def test_creates_and_returns_response(self):
        repo = MagicMock()
        repo.create.return_value = _make_tag()
        svc = _make_service(repo)

        result = svc.create_tag(name="python", description="Python lang")

        repo.create.assert_called_once_with(name="python", description="Python lang")
        assert result.name == "python"


class TestUpdateTag:
    def test_updates_fields_and_returns_response(self):
        tag = _make_tag()
        repo = MagicMock()
        repo.get_by_id.return_value = tag
        updated = _make_tag(name="rust", description="Rust lang")
        repo.update.return_value = updated
        svc = _make_service(repo)

        result = svc.update_tag(1, name="rust", description="Rust lang")

        repo.update.assert_called_once_with(tag, name="rust", description="Rust lang")
        assert result.name == "rust"

    def test_not_found_raises(self):
        repo = MagicMock()
        repo.get_by_id.return_value = None
        svc = _make_service(repo)

        with pytest.raises(ValueError, match="not found"):
            svc.update_tag(99, name="x", description="y")


class TestDeleteTag:
    def test_deletes_existing_tag(self):
        tag = _make_tag()
        repo = MagicMock()
        repo.get_by_id.return_value = tag
        svc = _make_service(repo)

        svc.delete_tag(1)

        repo.delete.assert_called_once_with(tag)

    def test_not_found_raises(self):
        repo = MagicMock()
        repo.get_by_id.return_value = None
        svc = _make_service(repo)

        with pytest.raises(ValueError, match="not found"):
            svc.delete_tag(99)
