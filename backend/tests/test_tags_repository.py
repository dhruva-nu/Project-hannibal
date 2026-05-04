from unittest.mock import MagicMock

from app.repositories.tags_repository import TagsRepository
from tests.helpers import _chain, _db


class TestTagsRepository:
    def test_init_stores_db(self):
        db = _db()
        repo = TagsRepository(db)
        assert repo._db is db

    def test_get_all(self):
        db = _db()
        db.query.return_value.all.return_value = []
        repo = TagsRepository(db)
        assert repo.get_all() == []

    def test_get_by_id_found(self):
        tag = MagicMock()
        repo = TagsRepository(_chain(_db(), tag))
        assert repo.get_by_id(1) is tag

    def test_get_by_id_not_found(self):
        repo = TagsRepository(_chain(_db(), None))
        assert repo.get_by_id(999) is None

    def test_create_adds_and_returns(self):
        db = _db()
        repo = TagsRepository(db)
        repo.create(name="Python", description="Python tag")
        db.add.assert_called_once()
        db.commit.assert_called_once()
        db.refresh.assert_called_once()

    def test_update_sets_name_and_description(self):
        tag = MagicMock()
        db = _db()
        repo = TagsRepository(db)
        repo.update(tag, name="Go", description="Go language")
        assert tag.name == "Go"
        assert tag.description == "Go language"
        db.commit.assert_called_once()
        db.refresh.assert_called_once()

    def test_update_skips_none_fields(self):
        tag = MagicMock()
        db = _db()
        repo = TagsRepository(db)
        repo.update(tag, name=None, description=None)
        db.commit.assert_called_once()
        db.refresh.assert_called_once()

    def test_delete_removes_tag(self):
        tag = MagicMock()
        db = _db()
        repo = TagsRepository(db)
        repo.delete(tag)
        db.delete.assert_called_once_with(tag)
        db.commit.assert_called_once()
