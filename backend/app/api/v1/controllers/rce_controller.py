import json
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse

from app.dependencies.auth import require_auth
from app.exception.rce_exception import DependencyInstallError, UnpermittedDependency
from app.schemas.rce import ExecuteRequest, ExecuteResponse
from app.services import rce as rce_service
from app.services.rce.dependency_errors import (
    dependency_error_info,
    dependency_error_result,
)
from app.services.rce.events import DependencyErrorEvent, ErrorEvent, StdoutLine

router = APIRouter()
logger = logging.getLogger(__name__)

SUPPORTED_LANGUAGES = set(rce_service.RUNTIME.keys())


@router.post("/execute", response_model=ExecuteResponse)
async def execute_code(request: ExecuteRequest, _: dict = Depends(require_auth)):
    language = request.language.lower()

    if language not in SUPPORTED_LANGUAGES:
        logger.warning("unsupported language requested | language=%s", request.language)
        raise HTTPException(
            status_code=400,
            detail=f"Language '{request.language}' is not supported. Supported: {sorted(SUPPORTED_LANGUAGES)}.",
        )

    logger.info("execute request | language=%s", language)
    try:
        await rce_service.prepare_dependencies(request.code, language)
        result = await run_in_threadpool(rce_service.run_code, request.code, language)
    except (UnpermittedDependency, DependencyInstallError) as exc:
        logger.info("dependency error | language=%s error=%s", language, exc)
        return ExecuteResponse(language=language, **dependency_error_result(exc))
    except ValueError as exc:
        raise HTTPException(status_code=429, detail=str(exc))
    except Exception:
        logger.exception("unexpected execution error | language=%s", language)
        raise HTTPException(status_code=500, detail="Execution service error.")

    return ExecuteResponse(language=language, **result)


@router.post("/execute/stream")
async def execute_code_stream(
    request: ExecuteRequest,
    _: dict = Depends(require_auth),
):
    language = request.language.lower()

    if language not in SUPPORTED_LANGUAGES:
        logger.warning("unsupported language requested | language=%s", request.language)
        raise HTTPException(
            status_code=400,
            detail=f"Language '{request.language}' is not supported. Supported: {sorted(SUPPORTED_LANGUAGES)}.",
        )

    exec_id = str(uuid.uuid4())
    logger.info("execute/stream request | exec_id=%s language=%s", exec_id, language)

    async def _sse_generator():
        try:
            await rce_service.prepare_dependencies(request.code, language)
            async for line in rce_service.stream_code(request.code, language):
                event = StdoutLine(exec_id=exec_id, line=line.decode(errors="replace"))
                yield f"data: {json.dumps(event.to_dict())}\n\n"
        except (UnpermittedDependency, DependencyInstallError) as exc:
            event = DependencyErrorEvent(exec_id=exec_id, **dependency_error_info(exc))
            yield f"data: {json.dumps(event.to_dict())}\n\n"
        except ValueError as exc:
            yield f"data: {json.dumps(ErrorEvent(exec_id=exec_id, message=str(exc)).to_dict())}\n\n"
        except Exception:
            logger.exception("stream error | exec_id=%s language=%s", exec_id, language)
            yield f"data: {json.dumps(ErrorEvent(exec_id=exec_id, message='Execution service error.').to_dict())}\n\n"

    return StreamingResponse(_sse_generator(), media_type="text/event-stream")
