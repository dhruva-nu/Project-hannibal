import logging

from fastapi import APIRouter, Depends, HTTPException, status

from app.dependencies.health import get_health_service
from app.schemas.health import HealthResponse
from app.services.health_service import HealthService

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("", response_model=HealthResponse, summary="Health check")
def get_health(
    health_service: HealthService = Depends(get_health_service),
) -> HealthResponse:
    try:
        return health_service.get_health_status()
    except Exception:
        logger.exception("health check failed — database or infrastructure is unreachable")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service is unhealthy. The database may be unreachable.",
        )
