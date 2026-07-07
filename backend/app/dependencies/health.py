from typing import Annotated

from fastapi import Depends

from app.repositories.health_repository import HealthRepository
from app.services.health_service import HealthService


def get_health_service() -> HealthService:
    repository = HealthRepository()
    return HealthService(repository=repository)


HealthServiceDep = Annotated[HealthService, Depends(get_health_service)]
