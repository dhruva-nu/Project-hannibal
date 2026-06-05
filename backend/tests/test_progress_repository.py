"""Unit tests for ProgressRepository — SQLAlchemy session is mocked."""

from datetime import datetime, timezone
from unittest.mock import MagicMock

from app.models.lesson_model import Lesson
from app.models.user_course_progress_model import UserCourseProgress
from app.models.user_lesson_progress_model import UserLessonProgress
from app.repositories.progress_repository import ProgressRepository
from tests.helpers import _db


def _chain_filter(db, return_value):
    """db.query().filter().first() → return_value (single filter, multi-arg)."""
    db.query.return_value.filter.return_value.first.return_value = return_value
    return db


def _chain_join_filter(db, return_value):
    """db.query().join().filter().all() → return_value."""
    db.query.return_value.join.return_value.filter.return_value.all.return_value = (
        return_value
    )
    return db


def _make_progress(user_id: int = 1, course_id: int = 10) -> UserCourseProgress:
    row = UserCourseProgress()
    row.userId = user_id
    row.courseId = course_id
    row.activeLessonId = None
    row.placedNodeIds = []
    row.enrolledAt = datetime(2026, 6, 5, tzinfo=timezone.utc)
    row.updatedAt = datetime(2026, 6, 5, tzinfo=timezone.utc)
    return row


def _make_lesson_progress(user_id: int = 1, lesson_id: int = 100) -> UserLessonProgress:
    row = UserLessonProgress()
    row.userId = user_id
    row.lessonId = lesson_id
    row.completedAt = datetime(2026, 6, 5, tzinfo=timezone.utc)
    return row


class TestGetCourseProgress:
    def test_returns_row_when_found(self):
        row = _make_progress()
        db = _chain_filter(MagicMock(), row)
        assert ProgressRepository(db).get_course_progress(1, 10) is row

    def test_returns_none_when_missing(self):
        db = _chain_filter(MagicMock(), None)
        assert ProgressRepository(db).get_course_progress(1, 10) is None


class TestCreateCourseProgress:
    def test_adds_commits_and_refreshes(self):
        db = _db()
        repo = ProgressRepository(db)
        repo.create_course_progress(1, 10)
        db.add.assert_called_once()
        db.commit.assert_called_once()
        db.refresh.assert_called_once()

    def test_returns_new_row(self):
        db = _db()
        repo = ProgressRepository(db)
        result = repo.create_course_progress(1, 10)
        assert result.userId == 1
        assert result.courseId == 10
        assert result.placedNodeIds == []


class TestUpdateCourseProgress:
    def test_sets_active_lesson(self):
        db = _db()
        row = _make_progress()
        repo = ProgressRepository(db)
        repo.update_course_progress(row, active_lesson_id=50)
        assert row.activeLessonId == 50
        db.commit.assert_called_once()

    def test_merges_placed_node_ids(self):
        db = _db()
        row = _make_progress()
        row.placedNodeIds = ["a", "b"]
        repo = ProgressRepository(db)
        repo.update_course_progress(row, placed_node_ids=["b", "c"])
        assert set(row.placedNodeIds) == {"a", "b", "c"}

    def test_skips_none_fields(self):
        db = _db()
        row = _make_progress()
        row.activeLessonId = 5
        row.placedNodeIds = ["x"]
        repo = ProgressRepository(db)
        repo.update_course_progress(row)
        assert row.activeLessonId == 5
        assert row.placedNodeIds == ["x"]


class TestDeleteCourseProgress:
    def test_deletes_and_commits(self):
        db = _db()
        row = _make_progress()
        repo = ProgressRepository(db)
        repo.delete_course_progress(row)
        db.delete.assert_called_once_with(row)
        db.commit.assert_called_once()


class TestListCompletedLessonIds:
    def test_returns_ids(self):
        db = _chain_join_filter(MagicMock(), [(100,), (101,)])
        assert ProgressRepository(db).list_completed_lesson_ids(1, 10) == [100, 101]

    def test_empty_when_no_completions(self):
        db = _chain_join_filter(MagicMock(), [])
        assert ProgressRepository(db).list_completed_lesson_ids(1, 10) == []


class TestGetLessonProgress:
    def test_returns_row_when_found(self):
        row = _make_lesson_progress()
        db = _chain_filter(MagicMock(), row)
        assert ProgressRepository(db).get_lesson_progress(1, 100) is row

    def test_returns_none_when_missing(self):
        db = _chain_filter(MagicMock(), None)
        assert ProgressRepository(db).get_lesson_progress(1, 100) is None


class TestCreateLessonProgress:
    def test_adds_commits_and_refreshes(self):
        db = _db()
        repo = ProgressRepository(db)
        repo.create_lesson_progress(1, 100)
        db.add.assert_called_once()
        db.commit.assert_called_once()
        db.refresh.assert_called_once()

    def test_returns_new_row(self):
        db = _db()
        repo = ProgressRepository(db)
        result = repo.create_lesson_progress(1, 100)
        assert result.userId == 1
        assert result.lessonId == 100


class TestDeleteLessonProgressForCourse:
    def test_deletes_all_rows_for_course(self):
        r1 = _make_lesson_progress(lesson_id=100)
        r2 = _make_lesson_progress(lesson_id=101)
        db = _chain_join_filter(MagicMock(), [r1, r2])
        repo = ProgressRepository(db)
        repo.delete_lesson_progress_for_course(1, 10)
        assert db.delete.call_count == 2
        db.commit.assert_called_once()

    def test_noop_when_no_rows(self):
        db = _chain_join_filter(MagicMock(), [])
        repo = ProgressRepository(db)
        repo.delete_lesson_progress_for_course(1, 10)
        db.delete.assert_not_called()
        db.commit.assert_called_once()


class TestGetLesson:
    def test_returns_lesson_when_found(self):
        lesson = MagicMock(spec=Lesson)
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = lesson
        repo = ProgressRepository(db)
        assert repo.get_lesson(100) is lesson

    def test_returns_none_when_missing(self):
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = None
        repo = ProgressRepository(db)
        assert repo.get_lesson(999) is None
