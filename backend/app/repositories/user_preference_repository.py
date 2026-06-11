from datetime import UTC, datetime

from app.models.user_preference_model import UserPreference


class UserPreferenceRepository:
    async def get_by_id(self, pref_id: str) -> UserPreference | None:
        return await UserPreference.get(pref_id)

    async def create(self) -> UserPreference:
        doc = UserPreference()
        await doc.insert()
        return doc

    async def upsert_preference(
        self, doc: UserPreference, key: str, value: str
    ) -> UserPreference:
        doc.preferences[key] = value
        doc.updated_at = datetime.now(UTC)
        await doc.save()
        return doc
