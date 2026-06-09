from app.models.user_preference_model import UserPreference
from app.repositories.preference_key_repository import PreferenceKeyRepository
from app.repositories.user_preference_repository import UserPreferenceRepository
from app.repositories.user_repository import UserRepository


class UserPreferenceService:
    def __init__(
        self,
        pref_key_repo: PreferenceKeyRepository,
        pref_repo: UserPreferenceRepository,
        user_repo: UserRepository,
    ) -> None:
        self._pref_key_repo = pref_key_repo
        self._pref_repo = pref_repo
        self._user_repo = user_repo

    def list_keys(self):
        return self._pref_key_repo.list_all()

    def create_key(self, key: str, description: str):
        if self._pref_key_repo.get_by_key(key):
            raise ValueError(f"Preference key '{key}' already exists.")
        return self._pref_key_repo.create(key=key, description=description)

    async def get_preferences(self, user_id: int) -> dict[str, str]:
        user = self._user_repo.get_by_id(user_id)
        if not user or not user.preference_id:
            return {}
        doc = await self._pref_repo.get_by_id(user.preference_id)
        return doc.preferences if doc else {}

    async def upsert_preference(
        self, user_id: int, key: str, value: str
    ) -> dict[str, str]:
        if not self._pref_key_repo.get_by_key(key):
            raise ValueError(f"Unknown preference key: '{key}'.")
        user = self._user_repo.get_by_id(user_id)
        if not user:
            raise ValueError("User not found.")

        doc: UserPreference
        if user.preference_id:
            doc = await self._pref_repo.get_by_id(user.preference_id)
            if not doc:
                doc = await self._pref_repo.create()
                self._user_repo.set_preference_id(user_id, str(doc.id))
        else:
            doc = await self._pref_repo.create()
            self._user_repo.set_preference_id(user_id, str(doc.id))

        doc = await self._pref_repo.upsert_preference(doc, key, value)
        return doc.preferences
