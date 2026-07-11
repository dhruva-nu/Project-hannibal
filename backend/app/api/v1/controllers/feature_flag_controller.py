import logging

from fastapi import APIRouter, HTTPException, status

from app.dependencies.auth import CurrentUser
from app.dependencies.feature_flag import FeatureFlagServiceDep
from app.schemas.feature_flag import FeatureFlagEvaluation

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


@router.get("/", response_model=FeatureFlagEvaluation)
def evaluate_flags(
    service: FeatureFlagServiceDep,
    payload: CurrentUser,
) -> FeatureFlagEvaluation:
    user_id = _user_id(payload)
    role = payload.get("role", "")
    try:
        flags = service.evaluate_for_user(user_id, role)
        return FeatureFlagEvaluation(flags=flags)
    except Exception:
        logger.exception("failed to evaluate feature flags | user_id=%d", user_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to evaluate feature flags. Please try again later.",
        )
