"""Tests for app/main.py — run() entrypoint."""
from unittest.mock import patch

from app.main import run


def test_run_invokes_uvicorn():
    with patch("app.main.uvicorn.run") as mock_uvicorn:
        run()
    mock_uvicorn.assert_called_once_with(
        "app.main:app",
        host=mock_uvicorn.call_args.kwargs["host"],
        port=mock_uvicorn.call_args.kwargs["port"],
        reload=mock_uvicorn.call_args.kwargs["reload"],
    )
