import uuid

from app.repositories.build_block_repository import BuildBlockRepository
from app.schemas.build_block import BuildBlockResponse


class BuildBlockService:
    def __init__(self, repository: BuildBlockRepository) -> None:
        self._repository = repository

    async def list_blocks(self) -> list[BuildBlockResponse]:
        blocks = await self._repository.get_all()
        return [BuildBlockResponse.model_validate(b) for b in blocks]

    async def get_block(self, block_id: uuid.UUID) -> BuildBlockResponse:
        block = await self._repository.get_by_id(block_id)
        if not block:
            raise ValueError(f"BuildBlock {block_id} not found")
        return BuildBlockResponse.model_validate(block)

    async def create_block(
        self,
        instructions: str,
        input: str,
        output: str,
        test_code: str,
        code_template: str,
        type: str,
        id: uuid.UUID | None = None,
    ) -> BuildBlockResponse:
        block = await self._repository.create(
            instructions=instructions,
            input=input,
            output=output,
            test_code=test_code,
            code_template=code_template,
            type=type,
            id=id,
        )
        return BuildBlockResponse.model_validate(block)

    async def update_block(self, block_id: uuid.UUID, **fields) -> BuildBlockResponse:
        block = await self._repository.get_by_id(block_id)
        if not block:
            raise ValueError(f"BuildBlock {block_id} not found")
        block = await self._repository.update(block, **fields)
        return BuildBlockResponse.model_validate(block)

    async def delete_block(self, block_id: uuid.UUID) -> None:
        block = await self._repository.get_by_id(block_id)
        if not block:
            raise ValueError(f"BuildBlock {block_id} not found")
        await self._repository.delete(block)
