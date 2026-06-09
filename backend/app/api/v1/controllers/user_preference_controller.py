import logging

from fastapi import APIRouter, Depends, HTTPException, status

from app.dependencies.auth import require_admin, require_auth
from app.dependencies.user_preference import get_user_preference_service
from app.schemas.user_preference import (
    PreferenceKeyResponse,
    PreferenceUpsert,
    UserPreferenceResponse,
)
from app.services.user_preference_service import UserPreferenceService

router = APIRouter()
logger = logging.getLogger(__name__)


def _user_id(payload: dict) -> int:
    try:
        return int(payload["sub"])
    except KeyError, TypeError, ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid auth payload",
        )


@router.get("/", response_model=UserPreferenceResponse)
async def get_preferences(
    service: UserPreferenceService = Depends(get_user_preference_service),
    payload: dict = Depends(require_auth),
) -> UserPreferenceResponse:
    user_id = _user_id(payload)
    try:
        prefs = await service.get_preferences(user_id)
        return UserPreferenceResponse(preferences=prefs)
    except Exception:
        logger.exception("failed to fetch preferences | user_id=%d", user_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve preferences.",
        )


@router.put("/", response_model=UserPreferenceResponse)
async def upsert_preference(
    body: PreferenceUpsert,
    service: UserPreferenceService = Depends(get_user_preference_service),
    payload: dict = Depends(require_auth),
) -> UserPreferenceResponse:
    user_id = _user_id(payload)
    try:
        prefs = await service.upsert_preference(user_id, body.key, body.value)
        return UserPreferenceResponse(preferences=prefs)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        )
    except Exception:
        logger.exception(
            "failed to upsert preference | user_id=%d key=%s", user_id, body.key
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save preference.",
        )


@router.get("/keys", response_model=list[PreferenceKeyResponse])
def list_keys(
    service: UserPreferenceService = Depends(get_user_preference_service),
    payload: dict = Depends(require_auth),
) -> list[PreferenceKeyResponse]:
    try:
        return service.list_keys()
    except Exception:
        logger.exception("failed to list preference keys")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve preference keys.",
        )


@router.post(
    "/keys", response_model=PreferenceKeyResponse, status_code=status.HTTP_201_CREATED
)
def create_key(
    body: PreferenceUpsert,
    service: UserPreferenceService = Depends(get_user_preference_service),
    payload: dict = Depends(require_admin),
) -> PreferenceKeyResponse:
    try:
        return service.create_key(key=body.key, description=body.value)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    except Exception:
        logger.exception("failed to create preference key | key=%s", body.key)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create preference key.",
        )
