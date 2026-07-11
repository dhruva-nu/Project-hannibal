import logging

from fastapi import APIRouter, HTTPException, status

from app.dependencies.auth import AdminUser
from app.dependencies.feature_flag import FeatureFlagServiceDep
from app.schemas.feature_flag import (
    FeatureFlagCreate,
    FeatureFlagResponse,
    FeatureFlagUpdate,
)

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/", response_model=list[FeatureFlagResponse])
def list_flags(
    service: FeatureFlagServiceDep,
    _admin: AdminUser,
) -> list[FeatureFlagResponse]:
    try:
        return service.list_flags()
    except Exception:
        logger.exception("failed to list feature flags")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve feature flags. Please try again later.",
        )


@router.get("/{key}", response_model=FeatureFlagResponse)
def get_flag(
    key: str,
    service: FeatureFlagServiceDep,
    _admin: AdminUser,
) -> FeatureFlagResponse:
    try:
        return service.get_flag(key)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Feature flag {key!r} does not exist.",
        )
    except Exception:
        logger.exception("unexpected error fetching feature flag | key=%r", key)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve feature flag. Please try again later.",
        )


@router.post(
    "/", response_model=FeatureFlagResponse, status_code=status.HTTP_201_CREATED
)
def create_flag(
    body: FeatureFlagCreate,
    service: FeatureFlagServiceDep,
    _admin: AdminUser,
) -> FeatureFlagResponse:
    try:
        flag = service.create_flag(
            key=body.key,
            description=body.description,
            enabled=body.enabled,
            rollout_percentage=body.rollout_percentage,
            target_roles=body.target_roles,
        )
        logger.info("feature flag created | key=%r", flag.key)
        return flag
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Feature flag {body.key!r} already exists.",
        )
    except Exception:
        logger.exception("failed to create feature flag | key=%r", body.key)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create feature flag. Please try again later.",
        )


@router.patch("/{key}", response_model=FeatureFlagResponse)
def update_flag(
    key: str,
    body: FeatureFlagUpdate,
    service: FeatureFlagServiceDep,
    _admin: AdminUser,
) -> FeatureFlagResponse:
    try:
        flag = service.update_flag(key, body)
        logger.info("feature flag updated | key=%r", key)
        return flag
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Feature flag {key!r} does not exist.",
        )
    except Exception:
        logger.exception("unexpected error updating feature flag | key=%r", key)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update feature flag. Please try again later.",
        )


@router.delete("/{key}", status_code=status.HTTP_204_NO_CONTENT)
def delete_flag(
    key: str,
    service: FeatureFlagServiceDep,
    _admin: AdminUser,
) -> None:
    try:
        service.delete_flag(key)
        logger.info("feature flag deleted | key=%r", key)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Feature flag {key!r} does not exist.",
        )
    except Exception:
        logger.exception("unexpected error deleting feature flag | key=%r", key)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete feature flag. Please try again later.",
        )
