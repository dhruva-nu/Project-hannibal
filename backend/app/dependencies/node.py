from typing import Annotated

from fastapi import Depends

from app.repositories.node_repository import NodeRepository
from app.services.node_service import NodeService


def get_node_service() -> NodeService:
    return NodeService(NodeRepository())


NodeServiceDep = Annotated[NodeService, Depends(get_node_service)]
