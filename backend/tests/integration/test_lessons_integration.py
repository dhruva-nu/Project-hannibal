"""Integration tests for /api/v1/lessons.

Exercises controller → LessonService → LessonRepository with a mock DB session.
All lesson endpoints are public (no auth required).
"""

import uuid

from app.models.lesson_model import Lesson, LessonType

_UUID = uuid.UUID("12345678-1234-5678-1234-567812345678")

_ATTRS = dict(
    id=1,
    courseId=1,
    name="Lesson 1",
    learning="You will learn X",
    nosqlId=_UUID,
    lessonType=LessonType.learn,
    order=1,
)

_CREATE_PAYLOAD = {
    "courseId": 1,
    "name": "Lesson 1",
    "learning": "You will learn X",
    "nosqlId": str(_UUID),
    "lessonType": "learn",
}


def _lesson(**overrides) -> Lesson:
    return Lesson(**{**_ATTRS, **overrides})


class TestListLessonsIntegration:
    def test_returns_all_lessons(self, client, mock_db):
        mock_db.query.return_value.all.return_value = [_lesson()]
        resp = client.get("/api/v1/lessons/")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["name"] == "Lesson 1"
        assert data[0]["lessonType"] == "learn"

    def test_empty_table_returns_empty_list(self, client, mock_db):
        mock_db.query.return_value.all.return_value = []
        resp = client.get("/api/v1/lessons/")
        assert resp.status_code == 200
        assert resp.json() == []


class TestListLessonsByCourseIntegration:
    def test_returns_lessons_for_course(self, client, mock_db):
        mock_db.query.return_value.filter.return_value.all.return_value = [_lesson()]
        resp = client.get("/api/v1/lessons/course/1")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["courseId"] == 1

    def test_course_with_no_lessons_returns_empty_list(self, client, mock_db):
        mock_db.query.return_value.filter.return_value.all.return_value = []
        resp = client.get("/api/v1/lessons/course/99")
        assert resp.status_code == 200
        assert resp.json() == []


class TestGetLessonIntegration:
    def test_existing_lesson_returns_200(self, client, mock_db):
        mock_db.query.return_value.filter.return_value.first.return_value = _lesson()
        resp = client.get("/api/v1/lessons/1")
        assert resp.status_code == 200
        body = resp.json()
        assert body["id"] == 1
        assert body["name"] == "Lesson 1"
        assert body["nosqlId"] == str(_UUID)

    def test_missing_lesson_returns_404_with_id_in_detail(self, client, mock_db):
        mock_db.query.return_value.filter.return_value.first.return_value = None
        resp = client.get("/api/v1/lessons/99")
        assert resp.status_code == 404
        assert "99" in resp.json()["detail"]


class TestCreateLessonIntegration:
    def test_creates_lesson_returns_201(self, client, mock_db):
        mock_db.refresh.side_effect = lambda obj: setattr(obj, "id", 1)
        resp = client.post("/api/v1/lessons/", json=_CREATE_PAYLOAD)
        assert resp.status_code == 201
        body = resp.json()
        assert body["name"] == "Lesson 1"
        assert body["lessonType"] == "learn"
        assert body["id"] == 1

    def test_db_add_and_commit_are_called(self, client, mock_db):
        mock_db.refresh.side_effect = lambda obj: setattr(obj, "id", 1)
        client.post("/api/v1/lessons/", json=_CREATE_PAYLOAD)
        mock_db.add.assert_called_once()
        mock_db.commit.assert_called()


class TestUpdateLessonIntegration:
    def test_updates_name_returns_200(self, client, mock_db):
        lesson = _lesson()
        mock_db.query.return_value.filter.return_value.first.return_value = lesson
        resp = client.patch("/api/v1/lessons/1", json={"name": "Updated Lesson"})
        assert resp.status_code == 200
        assert resp.json()["name"] == "Updated Lesson"

    def test_missing_lesson_returns_404(self, client, mock_db):
        mock_db.query.return_value.filter.return_value.first.return_value = None
        resp = client.patch("/api/v1/lessons/99", json={"name": "x"})
        assert resp.status_code == 404
        assert "99" in resp.json()["detail"]

    def test_partial_update_preserves_other_fields(self, client, mock_db):
        lesson = _lesson()
        mock_db.query.return_value.filter.return_value.first.return_value = lesson
        resp = client.patch(
            "/api/v1/lessons/1", json={"learning": "New learning objective"}
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "Lesson 1"
        assert resp.json()["learning"] == "New learning objective"


class TestDeleteLessonIntegration:
    def test_deletes_existing_lesson_returns_204(self, client, mock_db):
        mock_db.query.return_value.filter.return_value.first.return_value = _lesson()
        resp = client.delete("/api/v1/lessons/1")
        assert resp.status_code == 204

    def test_db_delete_and_commit_are_called(self, client, mock_db):
        lesson = _lesson()
        mock_db.query.return_value.filter.return_value.first.return_value = lesson
        client.delete("/api/v1/lessons/1")
        mock_db.delete.assert_called_once_with(lesson)
        mock_db.commit.assert_called()

    def test_missing_lesson_returns_404(self, client, mock_db):
        mock_db.query.return_value.filter.return_value.first.return_value = None
        resp = client.delete("/api/v1/lessons/99")
        assert resp.status_code == 404
