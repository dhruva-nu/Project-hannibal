from app.repositories.user_preference_repository import UserPreferenceRepository
from app.repositories.user_repository import UserRepository


async def build_user_memory(user_id: int, db) -> str:
    user = UserRepository(db).get_by_id(user_id)
    if not user:
        return ""

    parts = [f"Role: {user.role}"]
    if user.name:
        parts.append(f"Name: {user.name}")
    identity = " | ".join(parts)

    prefs: dict[str, str] = {}
    if user.preference_id:
        doc = await UserPreferenceRepository().get_by_id(user.preference_id)
        if doc and doc.preferences:
            prefs = dict(doc.preferences)

    if not prefs:
        return identity

    prefs_line = ", ".join(f"{k}={v}" for k, v in prefs.items())
    return f"{identity}\nPreferences: {prefs_line}"
