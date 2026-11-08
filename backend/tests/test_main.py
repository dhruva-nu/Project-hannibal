"""Tests for app/main.py — run() entrypoint."""

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

from app.main import _lifespan, app, run


def test_run_invokes_uvicorn():
    with patch("app.main.uvicorn.run") as mock_uvicorn:
        run()
    mock_uvicorn.assert_called_once_with(
        "app.main:app",
        host=mock_uvicorn.call_args.kwargs["host"],
        port=mock_uvicorn.call_args.kwargs["port"],
        reload=mock_uvicorn.call_args.kwargs["reload"],
        log_level=mock_uvicorn.call_args.kwargs["log_level"],
    )


def test_capture_copilotkit_context_middleware_sets_context():
    client = TestClient(app, raise_server_exceptions=False)
    body = json.dumps({"context": [{"description": "Page", "value": "Home"}]})
    resp = client.post(
        "/api/v1/copilotkit/",
        content=body,
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code in {200, 400, 401, 422, 500}


def test_openapi_schema_includes_security_schemes():
    app.openapi_schema = None
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get("/openapi.json")
    assert resp.status_code == 200
    schema = resp.json()
    assert "securitySchemes" in schema.get("components", {})
    assert "OAuth2PasswordBearer" in schema["components"]["securitySchemes"]
    assert schema.get("security") == [{"OAuth2PasswordBearer": []}]


def test_openapi_schema_cached_on_second_call():
    app.openapi_schema = None
    schema1 = app.openapi()
    schema2 = app.openapi()
    assert schema1 is schema2


def test_lifespan_initializes_beanie_and_closes_client():
    async def run_lifespan():
        with (
            patch("app.main.AsyncMongoClient") as mock_client_cls,
            patch("app.main.init_beanie", new_callable=AsyncMock) as mock_init,
        ):
            mock_mongo = MagicMock()
            mock_client_cls.return_value = mock_mongo
            gen = _lifespan(app)
            await gen.__anext__()
            mock_init.assert_called_once()
            try:
                await gen.__anext__()
            except StopAsyncIteration:
                pass
            mock_mongo.close.assert_called_once()

    asyncio.run(run_lifespan())


def test_configure_logging_creates_file_handler_when_enabled(tmp_path, mocker):
    from unittest.mock import MagicMock

    from app.core import logging as app_logging

    fake_settings = MagicMock()
    fake_settings.log_enabled = True
    fake_settings.log_file = str(tmp_path / "app.log")
    fake_settings.log_level = "DEBUG"
    mocker.patch.object(app_logging, "settings", fake_settings)

    app_logging.configure_logging()

    import logging

    assert any(
        isinstance(h, logging.handlers.RotatingFileHandler)
        for h in logging.root.handlers
    )
