import uuid
from unittest.mock import MagicMock

from app.models.lesson_model import LessonType
from app.repositories.lesson_repository import LessonRepository
from tests.helpers import _chain, _db


class TestLessonRepository:
    def test_init_stores_db(self):
        db = _db()
        repo = LessonRepository(db)
        assert repo._db is db

    def test_get_all(self):
        db = _db()
        db.query.return_value.all.return_value = []
        repo = LessonRepository(db)
        assert repo.get_all() == []

    def test_get_by_id_found(self):
        lesson = MagicMock()
        repo = LessonRepository(_chain(_db(), lesson))
        assert repo.get_by_id(1) is lesson

    def test_get_by_id_not_found(self):
        repo = LessonRepository(_chain(_db(), None))
        assert repo.get_by_id(999) is None

    def test_get_by_course(self):
        lessons = [MagicMock()]
        db = _db()
        db.query.return_value.filter.return_value.all.return_value = lessons
        repo = LessonRepository(db)
        assert repo.get_by_course(1) == lessons

    def test_create_adds_and_returns(self):
        db = _db()
        repo = LessonRepository(db)
        repo.create(
            courseId=1,
            name="Lesson 1",
            learning="learn stuff",
            nosqlId=uuid.uuid4(),
            lessonType=LessonType.learn,
        )
        db.add.assert_called_once()
        db.commit.assert_called_once()
        db.refresh.assert_called_once()

    def test_update_sets_non_none_fields(self):
        lesson = MagicMock()
        db = _db()
        repo = LessonRepository(db)
        repo.update(lesson, name="Updated", lessonType=None)
        assert lesson.name == "Updated"
        db.commit.assert_called_once()
        db.refresh.assert_called_once()

    def test_delete_removes_lesson(self):
        lesson = MagicMock()
        db = _db()
        repo = LessonRepository(db)
        repo.delete(lesson)
        db.delete.assert_called_once_with(lesson)
        db.commit.assert_called_once()
