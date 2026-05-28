import logging

from fastapi import APIRouter, Depends, HTTPException

from app.dependencies.auth import require_auth
from app.schemas.run_code import RunSimpleRequest, RunSimpleResponse
from app.services import rce as rce_service

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/run-simple", response_model=RunSimpleResponse)
def run_simple(request: RunSimpleRequest, _: dict = Depends(require_auth)):
    language = request.language.lower()

    if language not in rce_service.SUPPORTED_LANGS:
        logger.warning("unsupported language requested | language=%s", request.language)
        raise HTTPException(
            status_code=400,
            detail=f"Language '{request.language}' is not supported. Supported: {sorted(rce_service.SUPPORTED_LANGS)}.",
        )

    logger.info("run_simple request | language=%s block_id=%s", language, request.block_id)
    try:
        result = rce_service.run_simple(request.code, language, request.block_id)
    except ValueError as exc:
        raise HTTPException(status_code=429, detail=str(exc))
    except Exception:
        logger.exception("unexpected run_simple error | language=%s block_id=%s", language, request.block_id)
        raise HTTPException(status_code=500, detail="Run code service error.")

    return RunSimpleResponse(language=language, block_id=request.block_id, **result)
