import logging

from fastapi import APIRouter, HTTPException
from app.schemas.rce import ExecuteRequest, ExecuteResponse
from app.services import rce_service

router = APIRouter()
logger = logging.getLogger(__name__)

SUPPORTED_LANGUAGES = set(rce_service.RUNTIME.keys())


@router.post("/execute", response_model=ExecuteResponse)
def execute_code(request: ExecuteRequest):
    language = request.language.lower()

    if language not in SUPPORTED_LANGUAGES:
        logger.warning("unsupported language requested | language=%s", request.language)
        raise HTTPException(
            status_code=400,
            detail=f"Language '{request.language}' is not supported. Supported: {sorted(SUPPORTED_LANGUAGES)}.",
        )

    logger.info("execute request | language=%s", language)
    result = rce_service.run_code(request.code, language)

    return ExecuteResponse(language=language, **result)
