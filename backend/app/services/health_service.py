from app.repositories.health_repository import HealthRepository
from app.schemas.health import HealthResponse


class HealthService:
    def __init__(self, repository: HealthRepository) -> None:
        self._repository = repository

    def get_health_status(self) -> HealthResponse:
        payload = self._repository.get()
        return HealthResponse.model_validate(payload)
