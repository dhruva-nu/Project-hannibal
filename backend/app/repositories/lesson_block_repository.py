import uuid

from app.models.lesson_block_model import LessonBlock


class LessonBlockRepository:
    async def get_all(self) -> list[LessonBlock]:
        return await LessonBlock.find_all().to_list()

    async def get_by_id(self, block_id: uuid.UUID) -> LessonBlock | None:
        return await LessonBlock.find_one(LessonBlock.id == block_id)

    async def create(self, content: str, summary: str, id: uuid.UUID | None = None) -> LessonBlock:
        block = LessonBlock(id=id or uuid.uuid4(), content=content, summary=summary)
        await block.insert()
        return block

    async def update(self, block: LessonBlock, **fields) -> LessonBlock:
        await block.set(fields)
        return block

    async def delete(self, block: LessonBlock) -> None:
        await block.delete()
