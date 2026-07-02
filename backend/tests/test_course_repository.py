from unittest.mock import MagicMock

from app.models.course_model import CourseLevel
from app.models.lesson_model import Lesson
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
        course = MagicMock()
        repo = CourseRepository(_chain(_db(), course))
        assert repo.get_by_id(1) is course

    def test_get_by_id_not_found(self):
        repo = CourseRepository(_chain(_db(), None))
        assert repo.get_by_id(999) is None

    def test_get_related_courses(self):
        related = [MagicMock()]
        db = _db()
        chain = db.query.return_value.join.return_value.filter.return_value
        chain.order_by.return_value.all.return_value = related
        repo = CourseRepository(db)
        assert repo.get_related_courses(1) == related

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
        course = MagicMock()
        db = _db()
        repo = CourseRepository(db)
        repo.update(course, name="New Name", enrolNum=None)
        assert course.name == "New Name"
        db.commit.assert_called_once()
        db.refresh.assert_called_once()

    def test_delete_removes_course(self):
        course = MagicMock()
        db = _db()
        repo = CourseRepository(db)
        repo.delete(course)
        db.delete.assert_called_once_with(course)
        db.commit.assert_called_once()


class TestGetLesson:
    def test_returns_lesson_when_found(self):
        lesson = MagicMock(spec=Lesson)
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = lesson
        assert CourseRepository(db).get_lesson(100) is lesson

    def test_returns_none_when_missing(self):
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = None
        assert CourseRepository(db).get_lesson(999) is None
