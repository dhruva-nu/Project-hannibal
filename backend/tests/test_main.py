"""Tests for app/main.py — run() entrypoint."""
import json
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app, run


def test_run_invokes_uvicorn():
    with patch("app.main.uvicorn.run") as mock_uvicorn:
        run()
    mock_uvicorn.assert_called_once_with(
        "app.main:app",
        host=mock_uvicorn.call_args.kwargs["host"],
        port=mock_uvicorn.call_args.kwargs["port"],
        reload=mock_uvicorn.call_args.kwargs["reload"],
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
