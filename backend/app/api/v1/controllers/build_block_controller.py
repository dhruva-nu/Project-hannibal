import uuid

from fastapi import APIRouter, Depends, HTTPException, status

from app.dependencies.build_block import get_build_block_service
from app.schemas.build_block import (
    BuildBlockCreate,
    BuildBlockResponse,
    BuildBlockUpdate,
)
from app.services.build_block_service import BuildBlockService

router = APIRouter()


@router.get("/", response_model=list[BuildBlockResponse])
async def list_build_blocks(
    service: BuildBlockService = Depends(get_build_block_service),
) -> list[BuildBlockResponse]:
    return await service.list_blocks()


@router.get("/{block_id}", response_model=BuildBlockResponse)
async def get_build_block(
    block_id: uuid.UUID, service: BuildBlockService = Depends(get_build_block_service)
) -> BuildBlockResponse:
    try:
        return await service.get_block(block_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.post("/", response_model=BuildBlockResponse, status_code=status.HTTP_201_CREATED)
async def create_build_block(
    body: BuildBlockCreate,
    service: BuildBlockService = Depends(get_build_block_service),
) -> BuildBlockResponse:
    return await service.create_block(
        instructions=body.instructions,
        input=body.input,
        output=body.output,
        test_code=body.test_code,
        code_template=body.code_template,
        id=body.id,
    )


@router.patch("/{block_id}", response_model=BuildBlockResponse)
async def update_build_block(
    block_id: uuid.UUID,
    body: BuildBlockUpdate,
    service: BuildBlockService = Depends(get_build_block_service),
) -> BuildBlockResponse:
    try:
        return await service.update_block(
            block_id, **{k: v for k, v in body.model_dump().items() if v is not None}
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.delete("/{block_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_build_block(
    block_id: uuid.UUID, service: BuildBlockService = Depends(get_build_block_service)
) -> None:
    try:
        await service.delete_block(block_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
