from fastapi import APIRouter, Depends

from app.dependencies.health import get_health_service
from app.schemas.health import HealthResponse
from app.services.health_service import HealthService

router = APIRouter()


@router.get("", response_model=HealthResponse, summary="Health check")
def get_health(
    health_service: HealthService = Depends(get_health_service),
) -> HealthResponse:
    return health_service.get_health_status()
