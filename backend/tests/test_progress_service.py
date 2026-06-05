"""Unit tests for ProgressService — repositories are fully mocked."""

from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest

from app.models.course_model import Course, CourseLevel
from app.models.lesson_model import Lesson, LessonType
from app.models.user_course_progress_model import UserCourseProgress
from app.services.progress_service import ProgressService


def _make_progress(
    user_id: int = 1,
    course_id: int = 10,
    active_lesson_id: int | None = None,
    placed_node_ids: list[str] | None = None,
) -> UserCourseProgress:
    row = UserCourseProgress()
    row.userId = user_id
    row.courseId = course_id
    row.activeLessonId = active_lesson_id
    row.placedNodeIds = placed_node_ids or []
    row.enrolledAt = datetime(2026, 6, 5, tzinfo=timezone.utc)
    row.updatedAt = datetime(2026, 6, 5, tzinfo=timezone.utc)
    return row


def _make_course(id: int = 10, enrol_num: int = 0) -> Course:
    course = Course()
    course.id = id
    course.name = "Test Course"
    course.category = ["programming"]
    course.tagId = None
    course.enrolNum = enrol_num
    course.coverImg = "img.png"
    course.level = CourseLevel.beginner
    course.description = "desc"
    course.lessonCount = 0
    return course


def _make_lesson(id: int = 100, course_id: int = 10) -> Lesson:
    lesson = Lesson()
    lesson.id = id
    lesson.courseId = course_id
    lesson.name = "L"
    lesson.learning = "learn"
    lesson.lessonType = LessonType.learn
    lesson.order = 0
    return lesson


def _make_service(repo=None, course_repo=None) -> ProgressService:
    return ProgressService(
        repository=repo or MagicMock(),
        course_repository=course_repo or MagicMock(),
    )


class TestGetProgress:
    def test_returns_progress_when_enrolled(self):
        repo = MagicMock()
        repo.get_course_progress.return_value = _make_progress(
            placed_node_ids=["node-a"]
        )
        repo.list_completed_lesson_ids.return_value = [100, 101]
        svc = _make_service(repo)

        result = svc.get_progress(1, 10)

        assert result.courseId == 10
        assert result.completedLessonIds == [100, 101]
        assert result.placedNodeIds == ["node-a"]

    def test_raises_when_not_enrolled(self):
        repo = MagicMock()
        repo.get_course_progress.return_value = None
        svc = _make_service(repo)

        with pytest.raises(ValueError):
            svc.get_progress(1, 10)


class TestEnroll:
    def test_creates_row_and_bumps_enrol_num(self):
        repo = MagicMock()
        repo.get_course_progress.return_value = None
        repo.create_course_progress.return_value = _make_progress()
        repo.list_completed_lesson_ids.return_value = []
        course_repo = MagicMock()
        course_repo.get_by_id.return_value = _make_course(enrol_num=4)
        svc = _make_service(repo, course_repo)

        svc.enroll(1, 10)

        repo.create_course_progress.assert_called_once_with(1, 10)
        course_repo.update.assert_called_once()
        assert course_repo.update.call_args.kwargs["enrolNum"] == 5

    def test_idempotent_when_already_enrolled(self):
        repo = MagicMock()
        repo.get_course_progress.return_value = _make_progress()
        repo.list_completed_lesson_ids.return_value = []
        course_repo = MagicMock()
        svc = _make_service(repo, course_repo)

        svc.enroll(1, 10)

        repo.create_course_progress.assert_not_called()
        course_repo.update.assert_not_called()

    def test_raises_when_course_missing(self):
        repo = MagicMock()
        repo.get_course_progress.return_value = None
        course_repo = MagicMock()
        course_repo.get_by_id.return_value = None
        svc = _make_service(repo, course_repo)

        with pytest.raises(ValueError):
            svc.enroll(1, 10)


class TestUpdateProgress:
    def test_auto_enrolls_and_updates(self):
        repo = MagicMock()
        existing = _make_progress()
        repo.get_course_progress.side_effect = [None, existing, existing]
        repo.create_course_progress.return_value = existing
        repo.get_lesson.return_value = _make_lesson(id=100, course_id=10)
        repo.update_course_progress.return_value = _make_progress(
            active_lesson_id=100, placed_node_ids=["n1"]
        )
        repo.list_completed_lesson_ids.return_value = []
        course_repo = MagicMock()
        course_repo.get_by_id.return_value = _make_course()
        svc = _make_service(repo, course_repo)

        result = svc.update_progress(1, 10, active_lesson_id=100)

        assert result.activeLessonId == 100
        repo.update_course_progress.assert_called_once()

    def test_rejects_lesson_from_other_course(self):
        repo = MagicMock()
        repo.get_course_progress.return_value = _make_progress()
        repo.get_lesson.return_value = _make_lesson(id=100, course_id=99)
        svc = _make_service(repo)

        with pytest.raises(ValueError):
            svc.update_progress(1, 10, active_lesson_id=100)


class TestCompleteLesson:
    def test_creates_lesson_progress_and_returns_state(self):
        repo = MagicMock()
        repo.get_lesson.return_value = _make_lesson(id=100, course_id=10)
        repo.get_course_progress.return_value = _make_progress()
        repo.get_lesson_progress.return_value = None
        repo.list_completed_lesson_ids.return_value = [100]
        svc = _make_service(repo)

        result = svc.complete_lesson(1, 10, 100)

        repo.create_lesson_progress.assert_called_once_with(1, 100)
        assert 100 in result.completedLessonIds

    def test_idempotent_when_already_complete(self):
        repo = MagicMock()
        repo.get_lesson.return_value = _make_lesson(id=100, course_id=10)
        repo.get_course_progress.return_value = _make_progress()
        repo.get_lesson_progress.return_value = MagicMock()
        repo.list_completed_lesson_ids.return_value = [100]
        svc = _make_service(repo)

        svc.complete_lesson(1, 10, 100)

        repo.create_lesson_progress.assert_not_called()

    def test_rejects_lesson_from_other_course(self):
        repo = MagicMock()
        repo.get_lesson.return_value = _make_lesson(id=100, course_id=99)
        svc = _make_service(repo)

        with pytest.raises(ValueError):
            svc.complete_lesson(1, 10, 100)


class TestResetProgress:
    def test_deletes_when_enrolled(self):
        repo = MagicMock()
        row = _make_progress()
        repo.get_course_progress.return_value = row
        svc = _make_service(repo)

        svc.reset_progress(1, 10)

        repo.delete_lesson_progress_for_course.assert_called_once_with(1, 10)
        repo.delete_course_progress.assert_called_once_with(row)

    def test_noop_when_not_enrolled(self):
        repo = MagicMock()
        repo.get_course_progress.return_value = None
        svc = _make_service(repo)

        svc.reset_progress(1, 10)

        repo.delete_course_progress.assert_not_called()
