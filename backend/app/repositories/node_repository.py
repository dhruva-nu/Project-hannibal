from app.models.node_model import Node


class NodeRepository:
    async def get_by_id(self, node_id: str) -> Node | None:
        return await Node.find_one({"_id": node_id})

    async def get_children_of(self, parent_id: str) -> list[Node]:
        return await Node.find({"parent_id": parent_id}).to_list()

    async def get_many(self, node_ids: list[str]) -> list[Node]:
        return await Node.find({"_id": {"$in": node_ids}}).to_list()
