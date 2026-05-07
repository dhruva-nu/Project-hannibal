"""Integration tests for /api/v1/tags.

Exercises controller → TagsService → TagsRepository with a mock DB session.
All tag endpoints are public (no auth required).
"""
from app.models.tags_model import Tags

_ATTRS = dict(id=1, name="python", description="Python programming language")

_CREATE_PAYLOAD = {"name": "python", "description": "Python programming language"}


def _tag(**overrides) -> Tags:
    return Tags(**{**_ATTRS, **overrides})


class TestListTagsIntegration:
    def test_returns_all_tags(self, client, mock_db):
        mock_db.query.return_value.all.return_value = [_tag(), _tag(id=2, name="js")]
        resp = client.get("/api/v1/tags/")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        assert data[0]["name"] == "python"
        assert data[1]["name"] == "js"

    def test_empty_table_returns_empty_list(self, client, mock_db):
        mock_db.query.return_value.all.return_value = []
        resp = client.get("/api/v1/tags/")
        assert resp.status_code == 200
        assert resp.json() == []


class TestGetTagIntegration:
    def test_existing_tag_returns_200(self, client, mock_db):
        mock_db.query.return_value.filter.return_value.first.return_value = _tag()
        resp = client.get("/api/v1/tags/1")
        assert resp.status_code == 200
        body = resp.json()
        assert body["id"] == 1
        assert body["name"] == "python"
        assert body["description"] == "Python programming language"

    def test_missing_tag_returns_404_with_id_in_detail(self, client, mock_db):
        mock_db.query.return_value.filter.return_value.first.return_value = None
        resp = client.get("/api/v1/tags/99")
        assert resp.status_code == 404
        assert "99" in resp.json()["detail"]


class TestCreateTagIntegration:
    def test_creates_tag_returns_201(self, client, mock_db):
        mock_db.refresh.side_effect = lambda obj: setattr(obj, "id", 1)
        resp = client.post("/api/v1/tags/", json=_CREATE_PAYLOAD)
        assert resp.status_code == 201
        body = resp.json()
        assert body["name"] == "python"
        assert body["id"] == 1

    def test_db_add_and_commit_are_called(self, client, mock_db):
        mock_db.refresh.side_effect = lambda obj: setattr(obj, "id", 1)
        client.post("/api/v1/tags/", json=_CREATE_PAYLOAD)
        mock_db.add.assert_called_once()
        mock_db.commit.assert_called()


class TestUpdateTagIntegration:
    def test_updates_name_returns_200(self, client, mock_db):
        tag = _tag()
        mock_db.query.return_value.filter.return_value.first.return_value = tag
        resp = client.patch("/api/v1/tags/1", json={"name": "rust"})
        assert resp.status_code == 200
        assert resp.json()["name"] == "rust"

    def test_updates_description_returns_200(self, client, mock_db):
        tag = _tag()
        mock_db.query.return_value.filter.return_value.first.return_value = tag
        resp = client.patch("/api/v1/tags/1", json={"description": "New desc"})
        assert resp.status_code == 200
        assert resp.json()["description"] == "New desc"
        assert resp.json()["name"] == "python"

    def test_missing_tag_returns_404(self, client, mock_db):
        mock_db.query.return_value.filter.return_value.first.return_value = None
        resp = client.patch("/api/v1/tags/99", json={"name": "x"})
        assert resp.status_code == 404
        assert "99" in resp.json()["detail"]


class TestDeleteTagIntegration:
    def test_deletes_existing_tag_returns_204(self, client, mock_db):
        mock_db.query.return_value.filter.return_value.first.return_value = _tag()
        resp = client.delete("/api/v1/tags/1")
        assert resp.status_code == 204

    def test_db_delete_and_commit_are_called(self, client, mock_db):
        tag = _tag()
        mock_db.query.return_value.filter.return_value.first.return_value = tag
        client.delete("/api/v1/tags/1")
        mock_db.delete.assert_called_once_with(tag)
        mock_db.commit.assert_called()

    def test_missing_tag_returns_404(self, client, mock_db):
        mock_db.query.return_value.filter.return_value.first.return_value = None
        resp = client.delete("/api/v1/tags/99")
        assert resp.status_code == 404
