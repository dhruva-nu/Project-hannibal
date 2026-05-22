import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, status

from app.dependencies.build_block import get_build_block_service
from app.dependencies.dsl import get_dsl_service
from app.schemas.build_block import (
    BuildBlockCreate,
    BuildBlockResponse,
    BuildBlockUpdate,
)
from app.services.build_block_service import BuildBlockService
from app.services.dsl_service import DslService

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/", response_model=list[BuildBlockResponse])
async def list_build_blocks(
    service: BuildBlockService = Depends(get_build_block_service),
) -> list[BuildBlockResponse]:
    try:
        return await service.list_blocks()
    except Exception:
        logger.exception("failed to fetch build block list")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve build blocks. Please try again later.",
        )


@router.get("/{block_id}", response_model=BuildBlockResponse)
async def get_build_block(
    block_id: uuid.UUID, service: BuildBlockService = Depends(get_build_block_service)
) -> BuildBlockResponse:
    try:
        return await service.get_block(block_id)
    except ValueError:
        logger.warning("build block not found | block_id=%s", block_id)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Build block with id={block_id} does not exist.",
        )
    except Exception:
        logger.exception("unexpected error fetching build block | block_id=%s", block_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve build block. Please try again later.",
        )


@router.post("/", response_model=BuildBlockResponse, status_code=status.HTTP_201_CREATED)
async def create_build_block(
    body: BuildBlockCreate,
    service: BuildBlockService = Depends(get_build_block_service),
) -> BuildBlockResponse:
    try:
        block = await service.create_block(
            instructions=body.instructions,
            input=body.input,
            output=body.output,
            test_code=body.test_code,
            code_template=body.code_template,
            id=body.id,
        )
        logger.info("build block created | block_id=%s", block.id)
        return block
    except Exception:
        logger.exception("failed to create build block")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create build block. Please try again later.",
        )


@router.patch("/{block_id}", response_model=BuildBlockResponse)
async def update_build_block(
    block_id: uuid.UUID,
    body: BuildBlockUpdate,
    service: BuildBlockService = Depends(get_build_block_service),
) -> BuildBlockResponse:
    try:
        block = await service.update_block(
            block_id, **{k: v for k, v in body.model_dump().items() if v is not None}
        )
        logger.info("build block updated | block_id=%s", block_id)
        return block
    except ValueError:
        logger.warning("build block not found on update | block_id=%s", block_id)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Build block with id={block_id} does not exist.",
        )
    except Exception:
        logger.exception("unexpected error updating build block | block_id=%s", block_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update build block. Please try again later.",
        )


@router.get("/{block_id}/translate", response_model=dict)
async def translate_build_block(
    block_id: uuid.UUID,
    language: str,
    block_service: BuildBlockService = Depends(get_build_block_service),
    dsl_service: DslService = Depends(get_dsl_service),
) -> dict:
    try:
        block = await block_service.get_block(block_id)
        code = await dsl_service.translate(block.code_template, language)
        logger.info("build block translated | block_id=%s language=%s", block_id, language)
        return {"code": code}
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Build block with id={block_id} does not exist.",
        )
    except Exception:
        logger.exception("failed to translate build block | block_id=%s", block_id)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="DSL translation failed. Please try again later.",
        )


@router.delete("/{block_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_build_block(
    block_id: uuid.UUID, service: BuildBlockService = Depends(get_build_block_service)
) -> None:
    try:
        await service.delete_block(block_id)
        logger.info("build block deleted | block_id=%s", block_id)
    except ValueError:
        logger.warning("build block not found on delete | block_id=%s", block_id)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Build block with id={block_id} does not exist.",
        )
    except Exception:
        logger.exception("unexpected error deleting build block | block_id=%s", block_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete build block. Please try again later.",
        )
