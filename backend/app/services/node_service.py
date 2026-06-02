from app.models.node_model import Node
from app.repositories.node_repository import NodeRepository
from app.schemas.node import NodePlacementResponse, NodeResponse


class NodeService:
    def __init__(self, repository: NodeRepository) -> None:
        self._repository = repository

    async def get_placement(self, node_id: str) -> NodePlacementResponse:
        root = await self._repository.get_by_id(node_id)
        if not root:
            raise ValueError(f"Node {node_id} not found")

        visited: set[str] = {root.id}
        queue: list[Node] = [root]
        result: list[Node] = []

        while queue:
            node = queue.pop(0)
            result.append(node)

            for linked_id in node.linked_node_ids:
                if linked_id not in visited:
                    visited.add(linked_id)
                    linked = await self._repository.get_many([linked_id])
                    queue.extend(linked)

            if node.type == "service":
                children = await self._repository.get_children_of(node.id)
                for child in children:
                    if child.id not in visited:
                        visited.add(child.id)
                        queue.append(child)

        return NodePlacementResponse(
            nodes=[NodeResponse.model_validate(n) for n in result]
        )
