from typing import Annotated

from fastapi import Depends

from app.dependencies.db import DbSession
from app.repositories.feature_flag_repository import FeatureFlagRepository
from app.services.feature_flag_service import FeatureFlagService


def get_feature_flag_service(db: DbSession) -> FeatureFlagService:
    return FeatureFlagService(repository=FeatureFlagRepository(db=db))


FeatureFlagServiceDep = Annotated[FeatureFlagService, Depends(get_feature_flag_service)]
