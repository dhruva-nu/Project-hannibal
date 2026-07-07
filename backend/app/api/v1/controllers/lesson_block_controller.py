import logging
import uuid

from fastapi import APIRouter, HTTPException, status

from app.dependencies.lesson_block import LessonBlockServiceDep
from app.schemas.lesson_block import (
    LessonBlockCreate,
    LessonBlockResponse,
    LessonBlockUpdate,
)

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/", response_model=list[LessonBlockResponse])
async def list_lesson_blocks(
    service: LessonBlockServiceDep,
) -> list[LessonBlockResponse]:
    try:
        return await service.list_blocks()
    except Exception:
        logger.exception("failed to fetch lesson block list")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve lesson blocks. Please try again later.",
        )


@router.get("/{block_id}", response_model=LessonBlockResponse)
async def get_lesson_block(
    block_id: uuid.UUID, service: LessonBlockServiceDep
) -> LessonBlockResponse:
    try:
        return await service.get_block(block_id)
    except ValueError:
        logger.warning("lesson block not found | block_id=%s", block_id)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Lesson block with id={block_id} does not exist.",
        )
    except Exception:
        logger.exception(
            "unexpected error fetching lesson block | block_id=%s", block_id
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve lesson block. Please try again later.",
        )


@router.post(
    "/", response_model=LessonBlockResponse, status_code=status.HTTP_201_CREATED
)
async def create_lesson_block(
    body: LessonBlockCreate,
    service: LessonBlockServiceDep,
) -> LessonBlockResponse:
    try:
        block = await service.create_block(
            content=body.content, summary=body.summary, id=body.id
        )
        logger.info("lesson block created | block_id=%s", block.id)
        return block
    except Exception:
        logger.exception("failed to create lesson block")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create lesson block. Please try again later.",
        )


@router.patch("/{block_id}", response_model=LessonBlockResponse)
async def update_lesson_block(
    block_id: uuid.UUID,
    body: LessonBlockUpdate,
    service: LessonBlockServiceDep,
) -> LessonBlockResponse:
    try:
        block = await service.update_block(
            block_id, **{k: v for k, v in body.model_dump().items() if v is not None}
        )
        logger.info("lesson block updated | block_id=%s", block_id)
        return block
    except ValueError:
        logger.warning("lesson block not found on update | block_id=%s", block_id)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Lesson block with id={block_id} does not exist.",
        )
    except Exception:
        logger.exception(
            "unexpected error updating lesson block | block_id=%s", block_id
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update lesson block. Please try again later.",
        )


@router.delete("/{block_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_lesson_block(
    block_id: uuid.UUID, service: LessonBlockServiceDep
) -> None:
    try:
        await service.delete_block(block_id)
        logger.info("lesson block deleted | block_id=%s", block_id)
    except ValueError:
        logger.warning("lesson block not found on delete | block_id=%s", block_id)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Lesson block with id={block_id} does not exist.",
        )
    except Exception:
        logger.exception(
            "unexpected error deleting lesson block | block_id=%s", block_id
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete lesson block. Please try again later.",
        )
