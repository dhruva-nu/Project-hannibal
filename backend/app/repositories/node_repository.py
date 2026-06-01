from app.models.node_model import Node


class NodeRepository:
    async def get_by_id(self, node_id: str) -> Node | None:
        return await Node.find_one({"_id": node_id})

    async def get_children(self, parent_id: str) -> list[Node]:
        return await Node.find({"parent_id": parent_id}).to_list()
