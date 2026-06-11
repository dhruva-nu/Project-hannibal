from contextlib import contextmanager

from app.dependencies.db import get_db
from app.repositories.user_preference_repository import UserPreferenceRepository
from app.repositories.user_repository import UserRepository


@contextmanager
def _db_session():
    gen = get_db()
    db = next(gen)
    try:
        yield db
    finally:
        gen.close()


async def build_user_memory(user_id: int) -> str:
    with _db_session() as db:
        user = UserRepository(db).get_by_id(user_id)
    if not user:
        return ""

    identity = f"Role: {user.role}"

    prefs: dict[str, str] = {}
    if user.preference_id:
        doc = await UserPreferenceRepository().get_by_id(user.preference_id)
        if doc and doc.preferences:
            prefs = dict(doc.preferences)

    if not prefs:
        return identity

    prefs_line = ", ".join(f"{k}={v}" for k, v in prefs.items())
    return f"{identity}\nPreferences: {prefs_line}"
