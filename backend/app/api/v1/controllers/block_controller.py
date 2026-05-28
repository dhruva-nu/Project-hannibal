import asyncio
import logging

from fastapi import APIRouter, Depends, status
from fastapi.exceptions import HTTPException

from app.dependencies.build_block import get_build_block_service
from app.dependencies.course import get_lesson_service
from app.dependencies.lesson_block import get_lesson_block_service
from app.schemas.block import BlockItem, BuildBlockItem, LessonBlockItem
from app.schemas.lesson_block import LessonBlockResponse
from app.services.build_block_service import BuildBlockService
from app.services.lesson_block_service import LessonBlockService
from app.services.lesson_service import LessonService

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/", response_model=list[BlockItem])
async def list_blocks(
    lesson_service: LessonBlockService = Depends(get_lesson_block_service),
    build_service: BuildBlockService = Depends(get_build_block_service),
) -> list[BlockItem]:
    try:
        lesson_blocks, build_blocks = await asyncio.gather(
            lesson_service.list_blocks(),
            build_service.list_blocks(),
        )
    except Exception:
        logger.exception("failed to fetch blocks from one or both block stores")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Block storage is unavailable. Please try again later.",
        )
    return [LessonBlockItem(type="lesson", **b.model_dump()) for b in lesson_blocks] + [
        BuildBlockItem(type="build", **b.model_dump(exclude={"type"})) for b in build_blocks
    ]


@router.get("/{lesson_id}", response_model=LessonBlockResponse)
async def get_lesson_object(
    lesson_id: int,
    lesson_block_service: LessonBlockService = Depends(get_lesson_block_service),
    lesson_service: LessonService = Depends(get_lesson_service),
) -> LessonBlockResponse:
    try:
        no_sql_id = lesson_service.get_lesson(lesson_id).nosqlId
    except ValueError:
        logger.warning("lesson not found when fetching block | lesson_id=%d", lesson_id)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Lesson with id={lesson_id} does not exist.",
        )
    except Exception:
        logger.exception("unexpected error fetching lesson for block | lesson_id=%d", lesson_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve lesson. Please try again later.",
        )

    try:
        return await lesson_block_service.get_block(no_sql_id)
    except ValueError:
        logger.warning(
            "lesson block not found in NoSQL store | lesson_id=%d nosql_id=%s",
            lesson_id,
            no_sql_id,
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                f"Content block for lesson id={lesson_id} does not exist in the document store. "
                "The lesson record exists but its block was never initialized."
            ),
        )
    except Exception:
        logger.exception(
            "unexpected error fetching lesson block | lesson_id=%d nosql_id=%s",
            lesson_id,
            no_sql_id,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve lesson block. Please try again later.",
        )
