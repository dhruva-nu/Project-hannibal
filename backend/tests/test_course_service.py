"""Unit tests for CourseService — repository is fully mocked."""

from unittest.mock import MagicMock

import pytest

from app.models.course_model import Course, CourseLevel
from app.services.course_service import CourseService


def _make_course(
    id: int = 1,
    name: str = "Intro to Python",
    category: list[str] | None = None,
    tagId: int | None = None,
    enrolNum: int = 0,
    coverImg: str = "img.png",
    level: CourseLevel = CourseLevel.beginner,
    description: str = "A beginner course",
    lessonCount: int = 5,
) -> Course:
    course = Course()
    course.id = id
    course.name = name
    course.category = category or ["programming"]
    course.tagId = tagId
    course.enrolNum = enrolNum
    course.coverImg = coverImg
    course.level = level
    course.description = description
    course.lessonCount = lessonCount
    return course


def _make_service(repo=None) -> CourseService:
    return CourseService(repository=repo or MagicMock())


class TestListCourses:
    def test_returns_all_courses(self):
        repo = MagicMock()
        repo.get_all.return_value = [
            _make_course(1),
            _make_course(2, name="Advanced Python"),
        ]
        svc = _make_service(repo)

        result = svc.list_courses()

        assert len(result) == 2
        assert result[0].name == "Intro to Python"

    def test_empty_list(self):
        repo = MagicMock()
        repo.get_all.return_value = []
        svc = _make_service(repo)

        assert svc.list_courses() == []


class TestGetCourse:
    def test_found_returns_response(self):
        repo = MagicMock()
        repo.get_by_id.return_value = _make_course()
        svc = _make_service(repo)

        result = svc.get_course(1)

        assert result.id == 1
        assert result.name == "Intro to Python"

    def test_not_found_raises(self):
        repo = MagicMock()
        repo.get_by_id.return_value = None
        svc = _make_service(repo)

        with pytest.raises(ValueError, match="not found"):
            svc.get_course(99)


class TestCreateCourse:
    def test_creates_and_returns_response(self):
        repo = MagicMock()
        repo.create.return_value = _make_course()
        svc = _make_service(repo)

        result = svc.create_course(
            name="Intro to Python",
            category=["programming"],
            coverImg="img.png",
            level=CourseLevel.beginner,
            description="A beginner course",
        )

        repo.create.assert_called_once()
        assert result.name == "Intro to Python"
        assert result.level == CourseLevel.beginner

    def test_defaults_enrol_and_lesson_count_to_zero(self):
        repo = MagicMock()
        repo.create.return_value = _make_course()
        svc = _make_service(repo)

        svc.create_course(
            name="x",
            category=["a"],
            coverImg="x.png",
            level=CourseLevel.expert,
            description="desc",
        )

        _, kwargs = repo.create.call_args
        assert kwargs["enrolNum"] == 0
        assert kwargs["lessonCount"] == 0


class TestUpdateCourse:
    def test_updates_fields_and_returns_response(self):
        course = _make_course()
        repo = MagicMock()
        repo.get_by_id.return_value = course
        updated = _make_course(name="Updated", level=CourseLevel.intermediate)
        repo.update.return_value = updated
        svc = _make_service(repo)

        result = svc.update_course(1, name="Updated", level=CourseLevel.intermediate)

        repo.update.assert_called_once_with(
            course, name="Updated", level=CourseLevel.intermediate
        )
        assert result.name == "Updated"

    def test_not_found_raises(self):
        repo = MagicMock()
        repo.get_by_id.return_value = None
        svc = _make_service(repo)

        with pytest.raises(ValueError, match="not found"):
            svc.update_course(99, name="x")


class TestDeleteCourse:
    def test_deletes_existing_course(self):
        course = _make_course()
        repo = MagicMock()
        repo.get_by_id.return_value = course
        svc = _make_service(repo)

        svc.delete_course(1)

        repo.delete.assert_called_once_with(course)

    def test_not_found_raises(self):
        repo = MagicMock()
        repo.get_by_id.return_value = None
        svc = _make_service(repo)

        with pytest.raises(ValueError, match="not found"):
            svc.delete_course(99)
