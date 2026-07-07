import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.dependencies.auth import CurrentUser
from app.dependencies.rce import RceClientDep
from app.schemas.rce import ExecuteRequest, ExecuteResponse
from app.services.package_search.package_meta import SUPPORTED_LANGS
from app.services.rce_gateway.errors import (
    RceSaturated,
    RceServiceError,
    RceTimeout,
    RceUnavailable,
    raise_for_transport_error,
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
    _: CurrentUser,
    rce_client: RceClientDep,
):
    language = request.language.lower()
    _validate_language(language)

    logger.info("execute request | language=%s", language)
    try:
        result = await rce_client.execute(request.code, language)
    except (RceSaturated, RceTimeout, RceUnavailable) as exc:
        raise_for_transport_error(exc)
    except RceServiceError:
        logger.exception("execution service error | language=%s", language)
        raise HTTPException(status_code=500, detail="Execution service error.")

    return ExecuteResponse(language=language, **result)


@router.post("/execute/stream")
async def execute_code_stream(
    request: ExecuteRequest,
    _: CurrentUser,
    rce_client: RceClientDep,
):
    language = request.language.lower()
    _validate_language(language)

    logger.info("execute/stream request | language=%s", language)
    return StreamingResponse(
        stream_sse(rce_client, request.code, language),
        media_type="text/event-stream",
    )
