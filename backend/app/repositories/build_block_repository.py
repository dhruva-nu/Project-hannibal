import uuid

from app.models.build_block_model import BuildBlock


class BuildBlockRepository:
    async def get_all(self) -> list[BuildBlock]:
        return await BuildBlock.find_all().to_list()

    async def get_by_id(self, block_id: uuid.UUID) -> BuildBlock | None:
        return await BuildBlock.find_one({"_id": str(block_id)})

    async def create(
        self,
        instructions: str,
        input: str,
        output: str,
        test_code: str,
        code_template: str,
        type: str,
        id: uuid.UUID | None = None,
    ) -> BuildBlock:
        block = BuildBlock(
            id=id or uuid.uuid4(),
            instructions=instructions,
            input=input,
            output=output,
            test_code=test_code,
            code_template=code_template,
            type=type,
        )
        await block.insert()
        return block

    async def update(self, block: BuildBlock, **fields) -> BuildBlock:
        await block.set(fields)
        return block

    async def delete(self, block: BuildBlock) -> None:
        await block.delete()
