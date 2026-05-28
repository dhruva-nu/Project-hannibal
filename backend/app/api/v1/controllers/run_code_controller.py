import logging

from fastapi import APIRouter, Depends, HTTPException

from app.dependencies.auth import require_auth
from app.dependencies.build_block import get_build_block_service
from app.schemas.run_code import RunSimpleRequest, RunSimpleResponse
from app.services import rce as rce_service
from app.services.build_block_service import BuildBlockService

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/run-simple", response_model=RunSimpleResponse)
async def run_simple(
    request: RunSimpleRequest,
    _: dict = Depends(require_auth),
    build_block_service: BuildBlockService = Depends(get_build_block_service),
):
    language = request.language.lower()

    if language not in rce_service.SUPPORTED_LANGS:
        logger.warning("unsupported language requested | language=%s", request.language)
        raise HTTPException(
            status_code=400,
            detail=f"Language '{request.language}' is not supported. Supported: {sorted(rce_service.SUPPORTED_LANGS)}.",
        )

    logger.info(
        "run_simple request | language=%s block_id=%s", language, request.block_id
    )
    try:
        result = await rce_service.run_simple(
            request.code, language, request.block_id, build_block_service
        )
    except ValueError as exc:
        raise HTTPException(status_code=429, detail=str(exc))
    except Exception:
        logger.exception(
            "unexpected run_simple error | language=%s block_id=%s",
            language,
            request.block_id,
        )
        raise HTTPException(status_code=500, detail="Run code service error.")

    return RunSimpleResponse(language=language, block_id=request.block_id, **result)


""" 
request body to try
{
  "code": "def register(username: str, password: str) -> None:\n    db.store(username, password)\n\ndef authenticate(username: str, password: str) -> bool:\n    try:\n        passw = db.get(username)\n        if passw == password:\n            return True\n    except Exception:\n        return False\n    return False",
  "language": "python",
  "block_id": "bceb7645-03be-4fed-add0-eb390da03fd7"
}
"""
