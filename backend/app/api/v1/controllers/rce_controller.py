import logging

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app.dependencies.auth import require_auth
from app.dependencies.rce import get_rce_client
from app.schemas.rce import ExecuteRequest, ExecuteResponse
from app.services.package_search.package_meta import SUPPORTED_LANGS
from app.services.rce_gateway.client import RceQueueClient
from app.services.rce_gateway.errors import (
    RceSaturated,
    RceServiceError,
    RceTimeout,
    RceUnavailable,
)
from app.services.rce_gateway.sse_relay import stream_sse

router = APIRouter()
logger = logging.getLogger(__name__)

SUPPORTED_LANGUAGES = set(SUPPORTED_LANGS)


def _validate_language(language: str) -> None:
    if language not in SUPPORTED_LANGUAGES:
        logger.warning("unsupported language requested | language=%s", language)
        raise HTTPException(
            status_code=400,
            detail=f"Language '{language}' is not supported. Supported: {sorted(SUPPORTED_LANGUAGES)}.",
        )


@router.post("/execute", response_model=ExecuteResponse)
async def execute_code(
    request: ExecuteRequest,
    _: dict = Depends(require_auth),
    rce_client: RceQueueClient = Depends(get_rce_client),
):
    language = request.language.lower()
    _validate_language(language)

    logger.info("execute request | language=%s", language)
    try:
        result = await rce_client.execute(request.code, language)
    except RceSaturated as exc:
        raise HTTPException(status_code=429, detail=str(exc))
    except RceTimeout as exc:
        raise HTTPException(status_code=504, detail=str(exc))
    except RceUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except RceServiceError:
        logger.exception("execution service error | language=%s", language)
        raise HTTPException(status_code=500, detail="Execution service error.")

    return ExecuteResponse(language=language, **result)


@router.post("/execute/stream")
async def execute_code_stream(
    request: ExecuteRequest,
    _: dict = Depends(require_auth),
    rce_client: RceQueueClient = Depends(get_rce_client),
):
    language = request.language.lower()
    _validate_language(language)

    logger.info("execute/stream request | language=%s", language)
    return StreamingResponse(
        stream_sse(rce_client, request.code, language),
        media_type="text/event-stream",
    )
