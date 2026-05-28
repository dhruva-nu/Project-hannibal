"""Tests for /build-blocks CRUD endpoints."""

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from app.dependencies.build_block import get_build_block_service
from app.dependencies.dsl import get_dsl_service
from app.main import app
from app.schemas.build_block import BuildBlockResponse
from app.services.build_block_service import BuildBlockService
from app.services.dsl_service import DslService

client = TestClient(app, raise_server_exceptions=False)

_UUID = uuid.UUID("12345678-1234-5678-1234-567812345678")
_UUID_STR = str(_UUID)

_BLOCK = BuildBlockResponse(
    id=_UUID,
    instructions="Do this",
    input="stdin",
    output="stdout",
    test_code="assert True",
    code_template="def solve(): pass",
    type="simple_run",
)

_CREATE_PAYLOAD = {
    "instructions": "Do this",
    "input": "stdin",
    "output": "stdout",
    "test_code": "assert True",
    "code_template": "def solve(): pass",
    "type": "simple_run",
}


@pytest.fixture(autouse=True)
def clear_overrides():
    yield
    app.dependency_overrides.clear()


def _mock_dsl_service(**kwargs):
    mock = MagicMock(spec=DslService)
    for method, value in kwargs.items():
        if isinstance(value, Exception):
            setattr(mock, method, AsyncMock(side_effect=value))
        else:
            setattr(mock, method, AsyncMock(return_value=value))
    app.dependency_overrides[get_dsl_service] = lambda: mock
    return mock


def _mock_service(**kwargs):
    mock = MagicMock(spec=BuildBlockService)
    for method, value in kwargs.items():
        if isinstance(value, Exception):
            setattr(mock, method, AsyncMock(side_effect=value))
        else:
            setattr(mock, method, AsyncMock(return_value=value))
    app.dependency_overrides[get_build_block_service] = lambda: mock
    return mock


class TestListBuildBlocks:
    def test_success_returns_list(self):
        _mock_service(list_blocks=[_BLOCK])
        resp = client.get("/api/v1/build-blocks/")
        assert resp.status_code == 200
        assert len(resp.json()) == 1
        assert resp.json()[0]["instructions"] == "Do this"

    def test_empty_list_returns_200(self):
        _mock_service(list_blocks=[])
        resp = client.get("/api/v1/build-blocks/")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_exception_returns_500(self):
        _mock_service(list_blocks=RuntimeError("db down"))
        resp = client.get("/api/v1/build-blocks/")
        assert resp.status_code == 500


class TestGetBuildBlock:
    def test_found_returns_200(self):
        _mock_service(get_block=_BLOCK)
        resp = client.get(f"/api/v1/build-blocks/{_UUID_STR}")
        assert resp.status_code == 200
        assert resp.json()["id"] == _UUID_STR

    def test_not_found_returns_404(self):
        _mock_service(get_block=ValueError("not found"))
        resp = client.get(f"/api/v1/build-blocks/{_UUID_STR}")
        assert resp.status_code == 404
        assert _UUID_STR in resp.json()["detail"]

    def test_runtime_error_returns_500(self):
        _mock_service(get_block=RuntimeError("db down"))
        resp = client.get(f"/api/v1/build-blocks/{_UUID_STR}")
        assert resp.status_code == 500

    def test_invalid_uuid_returns_422(self):
        resp = client.get("/api/v1/build-blocks/not-a-uuid")
        assert resp.status_code == 422


class TestCreateBuildBlock:
    def test_success_returns_201(self):
        _mock_service(create_block=_BLOCK)
        resp = client.post("/api/v1/build-blocks/", json=_CREATE_PAYLOAD)
        assert resp.status_code == 201
        assert resp.json()["instructions"] == "Do this"

    def test_with_explicit_id_returns_201(self):
        _mock_service(create_block=_BLOCK)
        payload = {**_CREATE_PAYLOAD, "id": _UUID_STR}
        resp = client.post("/api/v1/build-blocks/", json=payload)
        assert resp.status_code == 201

    def test_missing_required_field_returns_422(self):
        payload = {k: v for k, v in _CREATE_PAYLOAD.items() if k != "instructions"}
        resp = client.post("/api/v1/build-blocks/", json=payload)
        assert resp.status_code == 422

    def test_exception_returns_500(self):
        _mock_service(create_block=RuntimeError("db down"))
        resp = client.post("/api/v1/build-blocks/", json=_CREATE_PAYLOAD)
        assert resp.status_code == 500


class TestUpdateBuildBlock:
    def test_success_returns_200(self):
        updated = BuildBlockResponse(**{**_BLOCK.model_dump(), "instructions": "Updated"})
        _mock_service(update_block=updated)
        resp = client.patch(f"/api/v1/build-blocks/{_UUID_STR}", json={"instructions": "Updated"})
        assert resp.status_code == 200
        assert resp.json()["instructions"] == "Updated"

    def test_partial_update_accepted(self):
        _mock_service(update_block=_BLOCK)
        resp = client.patch(f"/api/v1/build-blocks/{_UUID_STR}", json={})
        assert resp.status_code == 200

    def test_not_found_returns_404(self):
        _mock_service(update_block=ValueError("not found"))
        resp = client.patch(f"/api/v1/build-blocks/{_UUID_STR}", json={"instructions": "x"})
        assert resp.status_code == 404
        assert _UUID_STR in resp.json()["detail"]

    def test_runtime_error_returns_500(self):
        _mock_service(update_block=RuntimeError("db down"))
        resp = client.patch(f"/api/v1/build-blocks/{_UUID_STR}", json={"instructions": "x"})
        assert resp.status_code == 500

    def test_invalid_uuid_returns_422(self):
        resp = client.patch("/api/v1/build-blocks/not-a-uuid", json={"instructions": "x"})
        assert resp.status_code == 422


class TestTranslateBuildBlock:
    def test_success_returns_code(self):
        _mock_service(get_block=_BLOCK)
        _mock_dsl_service(translate="console.log('hello')")
        resp = client.get(f"/api/v1/build-blocks/{_UUID_STR}/translate?language=javascript")
        assert resp.status_code == 200
        assert resp.json() == {"code": "console.log('hello')"}

    def test_block_not_found_returns_404(self):
        _mock_service(get_block=ValueError("not found"))
        _mock_dsl_service(translate="irrelevant")
        resp = client.get(f"/api/v1/build-blocks/{_UUID_STR}/translate?language=javascript")
        assert resp.status_code == 404
        assert _UUID_STR in resp.json()["detail"]

    def test_dsl_error_returns_502(self):
        _mock_service(get_block=_BLOCK)
        _mock_dsl_service(translate=RuntimeError("dsl down"))
        resp = client.get(f"/api/v1/build-blocks/{_UUID_STR}/translate?language=javascript")
        assert resp.status_code == 502

    def test_missing_language_returns_422(self):
        resp = client.get(f"/api/v1/build-blocks/{_UUID_STR}/translate")
        assert resp.status_code == 422

    def test_invalid_uuid_returns_422(self):
        resp = client.get("/api/v1/build-blocks/not-a-uuid/translate?language=javascript")
        assert resp.status_code == 422


class TestDeleteBuildBlock:
    def test_success_returns_204(self):
        _mock_service(delete_block=None)
        resp = client.delete(f"/api/v1/build-blocks/{_UUID_STR}")
        assert resp.status_code == 204

    def test_not_found_returns_404(self):
        _mock_service(delete_block=ValueError("not found"))
        resp = client.delete(f"/api/v1/build-blocks/{_UUID_STR}")
        assert resp.status_code == 404
        assert _UUID_STR in resp.json()["detail"]

    def test_runtime_error_returns_500(self):
        _mock_service(delete_block=RuntimeError("db down"))
        resp = client.delete(f"/api/v1/build-blocks/{_UUID_STR}")
        assert resp.status_code == 500

    def test_invalid_uuid_returns_422(self):
        resp = client.delete("/api/v1/build-blocks/not-a-uuid")
        assert resp.status_code == 422
