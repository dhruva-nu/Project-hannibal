"""Shared fixtures for integration tests.

Each test overrides only get_db, so the real service + repository layers run.
"""

from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from jose import jwt

from app.core.config import settings
from app.dependencies.db import get_db
from app.main import app


@pytest.fixture(autouse=True)
def _clear_overrides():
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def client():
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture
def mock_db():
    db = MagicMock()
    app.dependency_overrides[get_db] = lambda: db
    return db


def _make_token(role: str = "student") -> str:
    return jwt.encode(
        {
            "sub": "1",
            "email": "test@example.com",
            "role": role,
            "exp": datetime.now(UTC) + timedelta(minutes=15),
        },
        settings.secret_key,
        algorithm=settings.jwt_algorithm,
    )


@pytest.fixture
def admin_token() -> str:
    return _make_token("admin")


@pytest.fixture
def user_token() -> str:
    return _make_token("student")
