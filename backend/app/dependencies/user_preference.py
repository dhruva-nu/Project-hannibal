from fastapi import Depends
from sqlalchemy.orm import Session

from app.dependencies.db import get_db
from app.repositories.preference_key_repository import PreferenceKeyRepository
from app.repositories.user_preference_repository import UserPreferenceRepository
from app.repositories.user_repository import UserRepository
from app.services.user_preference_service import UserPreferenceService


def get_user_preference_service(db: Session = Depends(get_db)) -> UserPreferenceService:
    return UserPreferenceService(
        pref_key_repo=PreferenceKeyRepository(db=db),
        pref_repo=UserPreferenceRepository(),
        user_repo=UserRepository(db=db),
    )
