"""Unit tests for LessonService — repository is fully mocked."""

import uuid
from unittest.mock import MagicMock

import pytest

from app.models.lesson_model import Lesson, LessonType
from app.services.lesson_service import LessonService

_UUID = uuid.UUID("12345678-1234-5678-1234-567812345678")


def _make_lesson(
    id: int = 1,
    courseId: int = 1,
    name: str = "Lesson 1",
    learning: str = "You will learn X",
    nosqlId: uuid.UUID = _UUID,
    lessonType: LessonType = LessonType.learn,
    order: int = 0,
) -> Lesson:
    lesson = Lesson()
    lesson.id = id
    lesson.courseId = courseId
    lesson.name = name
    lesson.learning = learning
    lesson.nosqlId = nosqlId
    lesson.lessonType = lessonType
    lesson.order = order
    return lesson


def _make_service(repo=None) -> LessonService:
    return LessonService(repository=repo or MagicMock())


class TestListLessons:
    def test_returns_all_lessons(self):
        repo = MagicMock()
        repo.get_all.return_value = [_make_lesson(1), _make_lesson(2, name="Lesson 2")]
        svc = _make_service(repo)

        result = svc.list_lessons()

        assert len(result) == 2
        assert result[0].name == "Lesson 1"

    def test_empty_list(self):
        repo = MagicMock()
        repo.get_all.return_value = []
        svc = _make_service(repo)

        assert svc.list_lessons() == []


class TestListByCourse:
    def test_returns_lessons_for_course(self):
        repo = MagicMock()
        repo.get_by_course.return_value = [
            _make_lesson(courseId=5),
            _make_lesson(2, courseId=5),
        ]
        svc = _make_service(repo)

        result = svc.list_by_course(5)

        repo.get_by_course.assert_called_once_with(5)
        assert len(result) == 2

    def test_no_lessons_returns_empty(self):
        repo = MagicMock()
        repo.get_by_course.return_value = []
        svc = _make_service(repo)

        assert svc.list_by_course(99) == []


class TestGetLesson:
    def test_found_returns_response(self):
        repo = MagicMock()
        repo.get_by_id.return_value = _make_lesson()
        svc = _make_service(repo)

        result = svc.get_lesson(1)

        assert result.id == 1
        assert result.name == "Lesson 1"

    def test_not_found_raises(self):
        repo = MagicMock()
        repo.get_by_id.return_value = None
        svc = _make_service(repo)

        with pytest.raises(ValueError, match="not found"):
            svc.get_lesson(99)


class TestCreateLesson:
    def test_creates_and_returns_response(self):
        repo = MagicMock()
        repo.create.return_value = _make_lesson()
        svc = _make_service(repo)

        result = svc.create_lesson(
            courseId=1,
            name="Lesson 1",
            learning="You will learn X",
            nosqlId=_UUID,
            lessonType=LessonType.learn,
        )

        repo.create.assert_called_once_with(
            courseId=1,
            name="Lesson 1",
            learning="You will learn X",
            nosqlId=_UUID,
            lessonType=LessonType.learn,
        )
        assert result.lessonType == LessonType.learn


class TestUpdateLesson:
    def test_updates_fields_and_returns_response(self):
        lesson = _make_lesson()
        repo = MagicMock()
        repo.get_by_id.return_value = lesson
        updated = _make_lesson(name="Updated", lessonType=LessonType.build)
        repo.update.return_value = updated
        svc = _make_service(repo)

        result = svc.update_lesson(1, name="Updated", lessonType=LessonType.build)

        repo.update.assert_called_once_with(
            lesson, name="Updated", lessonType=LessonType.build
        )
        assert result.name == "Updated"

    def test_not_found_raises(self):
        repo = MagicMock()
        repo.get_by_id.return_value = None
        svc = _make_service(repo)

        with pytest.raises(ValueError, match="not found"):
            svc.update_lesson(99, name="x")


class TestDeleteLesson:
    def test_deletes_existing_lesson(self):
        lesson = _make_lesson()
        repo = MagicMock()
        repo.get_by_id.return_value = lesson
        svc = _make_service(repo)

        svc.delete_lesson(1)

        repo.delete.assert_called_once_with(lesson)

    def test_not_found_raises(self):
        repo = MagicMock()
        repo.get_by_id.return_value = None
        svc = _make_service(repo)

        with pytest.raises(ValueError, match="not found"):
            svc.delete_lesson(99)
