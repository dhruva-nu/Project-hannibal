from contextlib import contextmanager

from langchain_core.tools import tool

from app.dependencies.db import get_db
from app.repositories.user_repository import UserRepository


@contextmanager
def _db_session():
    gen = get_db()
    db = next(gen)
    try:
        yield db
    finally:
        gen.close()


@tool
def get_user_profile(email: str) -> str:
    """Look up a registered user's profile by their email address."""
    with _db_session() as db:
        user = UserRepository(db).get_by_email(email)
        if not user:
            return f"No user found with email '{email}'."
        return (
            f"User profile — id: {user.id}, email: {user.email}, "
            f"provider: {user.provider}, member since: {user.created_at.date()}"
        )
