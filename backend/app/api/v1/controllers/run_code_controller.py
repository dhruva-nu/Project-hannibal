import logging

from fastapi import APIRouter, HTTPException

from app.dependencies.auth import CurrentUser
from app.dependencies.build_block import BuildBlockServiceDep
from app.dependencies.rce import RceClientDep
from app.schemas.run_code import RunSimpleRequest, RunSimpleResponse
from app.services.package_search.package_meta import SUPPORTED_LANGS
from app.services.rce_gateway.errors import (
    RceSaturated,
    RceServiceError,
    RceTimeout,
    RceUnavailable,
    raise_for_transport_error,
)
from app.services.rce_gateway.test_code import add_test_code

router = APIRouter()
logger = logging.getLogger(__name__)

SUPPORTED_LANGUAGES = set(SUPPORTED_LANGS)


@router.post("/run-simple", response_model=RunSimpleResponse)
async def run_simple(
    request: RunSimpleRequest,
    _: CurrentUser,
    build_block_service: BuildBlockServiceDep,
    rce_client: RceClientDep,
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
    except (RceSaturated, RceTimeout, RceUnavailable) as exc:
        raise_for_transport_error(exc)
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
