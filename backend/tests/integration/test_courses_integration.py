"""Integration tests for /api/v1/courses.

Exercises controller → CourseService → CourseRepository with a mock DB session.
Admin-protected routes use a real JWT with role=admin.
"""

from app.models.course_model import Course, CourseLevel

_ATTRS = dict(
    id=1,
    name="Intro to Python",
    category=["programming"],
    tagId=None,
    enrolNum=0,
    coverImg="img.png",
    level=CourseLevel.beginner,
    description="A beginner course",
    lessonCount=5,
)

_CREATE_PAYLOAD = {
    "name": "Intro to Python",
    "category": ["programming"],
    "coverImg": "img.png",
    "level": "beginner",
    "description": "A beginner course",
}


def _course(**overrides) -> Course:
    return Course(**{**_ATTRS, **overrides})


class TestListCoursesIntegration:
    def test_returns_all_courses_from_db(self, client, mock_db):
        mock_db.query.return_value.all.return_value = [_course()]
        resp = client.get("/api/v1/courses/")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["name"] == "Intro to Python"
        assert data[0]["level"] == "beginner"
        assert data[0]["id"] == 1

    def test_empty_table_returns_empty_list(self, client, mock_db):
        mock_db.query.return_value.all.return_value = []
        resp = client.get("/api/v1/courses/")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_multiple_courses_all_serialised(self, client, mock_db):
        courses = [_course(id=i, name=f"Course {i}") for i in range(1, 4)]
        mock_db.query.return_value.all.return_value = courses
        resp = client.get("/api/v1/courses/")
        assert resp.status_code == 200
        assert len(resp.json()) == 3


class TestGetCourseIntegration:
    def test_existing_course_returns_200(self, client, mock_db):
        mock_db.query.return_value.filter.return_value.first.return_value = _course()
        resp = client.get("/api/v1/courses/1")
        assert resp.status_code == 200
        body = resp.json()
        assert body["id"] == 1
        assert body["name"] == "Intro to Python"
        assert body["description"] == "A beginner course"

    def test_missing_course_returns_404_with_id_in_detail(self, client, mock_db):
        mock_db.query.return_value.filter.return_value.first.return_value = None
        resp = client.get("/api/v1/courses/99")
        assert resp.status_code == 404
        assert "99" in resp.json()["detail"]


class TestCreateCourseIntegration:
    def test_admin_creates_course_returns_201(self, client, mock_db, admin_token):
        mock_db.refresh.side_effect = lambda obj: setattr(obj, "id", 1)
        resp = client.post(
            "/api/v1/courses/",
            json=_CREATE_PAYLOAD,
            cookies={"access_token": admin_token},
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["name"] == "Intro to Python"
        assert body["id"] == 1
        assert body["level"] == "beginner"

    def test_unauthenticated_request_returns_401(self, client, mock_db):
        resp = client.post("/api/v1/courses/", json=_CREATE_PAYLOAD)
        assert resp.status_code == 401

    def test_non_admin_role_returns_403(self, client, mock_db, user_token):
        resp = client.post(
            "/api/v1/courses/",
            json=_CREATE_PAYLOAD,
            cookies={"access_token": user_token},
        )
        assert resp.status_code == 403

    def test_db_add_and_commit_are_called(self, client, mock_db, admin_token):
        mock_db.refresh.side_effect = lambda obj: setattr(obj, "id", 1)
        client.post(
            "/api/v1/courses/",
            json=_CREATE_PAYLOAD,
            cookies={"access_token": admin_token},
        )
        mock_db.add.assert_called_once()
        mock_db.commit.assert_called()


class TestUpdateCourseIntegration:
    def test_admin_updates_name_returns_200(self, client, mock_db, admin_token):
        course = _course()
        mock_db.query.return_value.filter.return_value.first.return_value = course
        resp = client.patch(
            "/api/v1/courses/1",
            json={"name": "Advanced Python"},
            cookies={"access_token": admin_token},
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "Advanced Python"

    def test_missing_course_returns_404(self, client, mock_db, admin_token):
        mock_db.query.return_value.filter.return_value.first.return_value = None
        resp = client.patch(
            "/api/v1/courses/99",
            json={"name": "x"},
            cookies={"access_token": admin_token},
        )
        assert resp.status_code == 404
        assert "99" in resp.json()["detail"]

    def test_unauthenticated_returns_401(self, client, mock_db):
        resp = client.patch("/api/v1/courses/1", json={"name": "x"})
        assert resp.status_code == 401

    def test_partial_payload_only_updates_provided_fields(
        self, client, mock_db, admin_token
    ):
        course = _course()
        mock_db.query.return_value.filter.return_value.first.return_value = course
        resp = client.patch(
            "/api/v1/courses/1",
            json={"description": "New description"},
            cookies={"access_token": admin_token},
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "Intro to Python"
        assert resp.json()["description"] == "New description"


class TestDeleteCourseIntegration:
    def test_admin_deletes_existing_course_returns_204(
        self, client, mock_db, admin_token
    ):
        mock_db.query.return_value.filter.return_value.first.return_value = _course()
        resp = client.delete("/api/v1/courses/1", cookies={"access_token": admin_token})
        assert resp.status_code == 204

    def test_db_delete_and_commit_are_called(self, client, mock_db, admin_token):
        course = _course()
        mock_db.query.return_value.filter.return_value.first.return_value = course
        client.delete("/api/v1/courses/1", cookies={"access_token": admin_token})
        mock_db.delete.assert_called_once_with(course)
        mock_db.commit.assert_called()

    def test_missing_course_returns_404(self, client, mock_db, admin_token):
        mock_db.query.return_value.filter.return_value.first.return_value = None
        resp = client.delete(
            "/api/v1/courses/99", cookies={"access_token": admin_token}
        )
        assert resp.status_code == 404

    def test_unauthenticated_returns_401(self, client, mock_db):
        resp = client.delete("/api/v1/courses/1")
        assert resp.status_code == 401
