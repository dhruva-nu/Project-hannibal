import asyncio

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
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Failed to fetch blocks",
        )
    return [LessonBlockItem(type="lesson", **b.model_dump()) for b in lesson_blocks] + [
        BuildBlockItem(type="build", **b.model_dump()) for b in build_blocks
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
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Lesson not found"
        )

    try:
        return await lesson_block_service.get_block(no_sql_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Lesson Block is not present in the NoSQL DB",
        )
