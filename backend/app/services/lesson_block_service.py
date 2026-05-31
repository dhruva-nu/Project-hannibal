import uuid

from app.repositories.lesson_block_repository import LessonBlockRepository
from app.schemas.lesson_block import LessonBlockResponse


class LessonBlockService:
    def __init__(self, repository: LessonBlockRepository) -> None:
        self._repository = repository

    async def list_blocks(self) -> list[LessonBlockResponse]:
        blocks = await self._repository.get_all()
        return [LessonBlockResponse.model_validate(b) for b in blocks]

    async def get_block(self, block_id: uuid.UUID) -> LessonBlockResponse:
        block = await self._repository.get_by_id(block_id)
        if not block:
            raise ValueError(f"LessonBlock {block_id} not found")
        return LessonBlockResponse.model_validate(block)

    async def create_block(
        self, content: str, summary: str, id: uuid.UUID | None = None
    ) -> LessonBlockResponse:
        block = await self._repository.create(content=content, summary=summary, id=id)
        return LessonBlockResponse.model_validate(block)

    async def update_block(self, block_id: uuid.UUID, **fields) -> LessonBlockResponse:
        block = await self._repository.get_by_id(block_id)
        if not block:
            raise ValueError(f"LessonBlock {block_id} not found")
        block = await self._repository.update(block, **fields)
        return LessonBlockResponse.model_validate(block)

    async def delete_block(self, block_id: uuid.UUID) -> None:
        block = await self._repository.get_by_id(block_id)
        if not block:
            raise ValueError(f"LessonBlock {block_id} not found")
        await self._repository.delete(block)
