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
        ordered: list[Node] = [root]
        queue: list[Node] = [root]

        while queue:
            current = queue.pop(0)

            if current.type == "module" and current.parent_id and current.parent_id not in visited:
                parent = await self._repository.get_by_id(current.parent_id)
                if parent:
                    visited.add(parent.id)
                    ordered.append(parent)
                    queue.append(parent)

            if current.type == "service":
                for child in await self._repository.get_children(current.id):
                    if child.id not in visited:
                        visited.add(child.id)
                        ordered.append(child)

            for linked_id in current.linked_node_ids or []:
                if linked_id in visited:
                    continue
                linked = await self._repository.get_by_id(linked_id)
                if linked:
                    visited.add(linked.id)
                    ordered.append(linked)
                    queue.append(linked)

        return NodePlacementResponse(
            nodes=[NodeResponse.model_validate(n) for n in ordered],
        )
