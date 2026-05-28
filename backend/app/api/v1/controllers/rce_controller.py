import logging

from fastapi import APIRouter, Depends, HTTPException

from app.dependencies.auth import require_auth
from app.schemas.rce import ExecuteRequest, ExecuteResponse
from app.services import rce as rce_service

router = APIRouter()
logger = logging.getLogger(__name__)

SUPPORTED_LANGUAGES = set(rce_service.RUNTIME.keys())


@router.post("/execute", response_model=ExecuteResponse)
def execute_code(request: ExecuteRequest, _: dict = Depends(require_auth)):
    language = request.language.lower()

    if language not in SUPPORTED_LANGUAGES:
        logger.warning("unsupported language requested | language=%s", request.language)
        raise HTTPException(
            status_code=400,
            detail=f"Language '{request.language}' is not supported. Supported: {sorted(SUPPORTED_LANGUAGES)}.",
        )

    logger.info("execute request | language=%s", language)
    try:
        result = rce_service.run_code(request.code, language)
    except ValueError as exc:
        raise HTTPException(status_code=429, detail=str(exc))
    except Exception:
        logger.exception("unexpected execution error | language=%s", language)
        raise HTTPException(status_code=500, detail="Execution service error.")

    return ExecuteResponse(language=language, **result)
