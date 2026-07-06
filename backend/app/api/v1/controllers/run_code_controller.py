import logging

from fastapi import APIRouter, Depends, HTTPException

from app.dependencies.auth import require_auth
from app.dependencies.build_block import get_build_block_service
from app.dependencies.rce import get_rce_client
from app.schemas.run_code import RunSimpleRequest, RunSimpleResponse
from app.services.build_block_service import BuildBlockService
from app.services.package_search.package_meta import SUPPORTED_LANGS
from app.services.rce_gateway.client import RceQueueClient
from app.services.rce_gateway.errors import (
    RceSaturated,
    RceServiceError,
    RceTimeout,
    RceUnavailable,
)
from app.services.rce_gateway.test_code import add_test_code

router = APIRouter()
logger = logging.getLogger(__name__)

SUPPORTED_LANGUAGES = set(SUPPORTED_LANGS)


@router.post("/run-simple", response_model=RunSimpleResponse)
async def run_simple(
    request: RunSimpleRequest,
    _: dict = Depends(require_auth),
    build_block_service: BuildBlockService = Depends(get_build_block_service),
    rce_client: RceQueueClient = Depends(get_rce_client),
):
    language = request.language.lower()

    if language not in SUPPORTED_LANGUAGES:
        logger.warning("unsupported language requested | language=%s", request.language)
        raise HTTPException(
            status_code=400,
            detail=f"Language '{request.language}' is not supported. Supported: {sorted(SUPPORTED_LANGUAGES)}.",
        )

    logger.info(
        "run_simple request | language=%s block_id=%s", language, request.block_id
    )
    try:
        combined = await add_test_code(
            request.code, request.block_id, build_block_service
        )
        result = await rce_client.execute(combined, language)
    except RceSaturated as exc:
        raise HTTPException(status_code=429, detail=str(exc))
    except RceTimeout as exc:
        raise HTTPException(status_code=504, detail=str(exc))
    except RceUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except RceServiceError:
        logger.exception("run_simple service error | block_id=%s", request.block_id)
        raise HTTPException(status_code=500, detail="Run code service error.")
    except Exception:
        logger.exception(
            "unexpected run_simple error | language=%s block_id=%s",
            language,
            request.block_id,
        )
        raise HTTPException(status_code=500, detail="Run code service error.")

    return RunSimpleResponse(language=language, block_id=request.block_id, **result)
