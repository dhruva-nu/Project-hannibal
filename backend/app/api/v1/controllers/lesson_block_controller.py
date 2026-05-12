import uuid

from fastapi import APIRouter, Depends, HTTPException, status

from app.dependencies.lesson_block import get_lesson_block_service
from app.schemas.lesson_block import LessonBlockCreate, LessonBlockResponse, LessonBlockUpdate
from app.services.lesson_block_service import LessonBlockService

router = APIRouter()


@router.get("/", response_model=list[LessonBlockResponse])
async def list_lesson_blocks(
    service: LessonBlockService = Depends(get_lesson_block_service),
) -> list[LessonBlockResponse]:
    return await service.list_blocks()


@router.get("/{block_id}", response_model=LessonBlockResponse)
async def get_lesson_block(
    block_id: uuid.UUID, service: LessonBlockService = Depends(get_lesson_block_service)
) -> LessonBlockResponse:
    try:
        return await service.get_block(block_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.post("/", response_model=LessonBlockResponse, status_code=status.HTTP_201_CREATED)
async def create_lesson_block(
    body: LessonBlockCreate, service: LessonBlockService = Depends(get_lesson_block_service)
) -> LessonBlockResponse:
    return await service.create_block(content=body.content, summary=body.summary, id=body.id)


@router.patch("/{block_id}", response_model=LessonBlockResponse)
async def update_lesson_block(
    block_id: uuid.UUID,
    body: LessonBlockUpdate,
    service: LessonBlockService = Depends(get_lesson_block_service),
) -> LessonBlockResponse:
    try:
        return await service.update_block(
            block_id, **{k: v for k, v in body.model_dump().items() if v is not None}
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.delete("/{block_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_lesson_block(
    block_id: uuid.UUID, service: LessonBlockService = Depends(get_lesson_block_service)
) -> None:
    try:
        await service.delete_block(block_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
