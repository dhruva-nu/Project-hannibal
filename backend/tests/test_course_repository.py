from app.models.course_model import CourseLevel
from app.repositories.course_repository import CourseRepository
from tests.helpers import _chain, _db


class TestCourseRepository:
    def test_init_stores_db(self):
        db = _db()
        repo = CourseRepository(db)
        assert repo._db is db

    def test_get_all(self):
        db = _db()
        db.query.return_value.all.return_value = []
        repo = CourseRepository(db)
        assert repo.get_all() == []

    def test_get_by_id_found(self):
        from unittest.mock import MagicMock

        course = MagicMock()
        repo = CourseRepository(_chain(_db(), course))
        assert repo.get_by_id(1) is course

    def test_get_by_id_not_found(self):
        repo = CourseRepository(_chain(_db(), None))
        assert repo.get_by_id(999) is None

    def test_create_adds_and_returns(self):
        db = _db()
        repo = CourseRepository(db)
        repo.create(
            name="Test",
            category=["dev"],
            coverImg="img.jpg",
            level=CourseLevel.beginner,
            description="desc",
        )
        db.add.assert_called_once()
        db.commit.assert_called_once()
        db.refresh.assert_called_once()

    def test_update_sets_non_none_fields(self):
        from unittest.mock import MagicMock

        course = MagicMock()
        db = _db()
        repo = CourseRepository(db)
        repo.update(course, name="New Name", enrolNum=None)
        assert course.name == "New Name"
        db.commit.assert_called_once()
        db.refresh.assert_called_once()

    def test_delete_removes_course(self):
        from unittest.mock import MagicMock

        course = MagicMock()
        db = _db()
        repo = CourseRepository(db)
        repo.delete(course)
        db.delete.assert_called_once_with(course)
        db.commit.assert_called_once()
