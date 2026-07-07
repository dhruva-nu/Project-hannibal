import logging

from fastapi import APIRouter, HTTPException, status

from app.dependencies.node import NodeServiceDep
from app.schemas.node import NodePlacementResponse

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/{node_id}/placement", response_model=NodePlacementResponse)
async def get_node_placement(
    node_id: str, service: NodeServiceDep
) -> NodePlacementResponse:
    try:
        return await service.get_placement(node_id)
    except ValueError:
        logger.warning("node not found | node_id=%s", node_id)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Node with id={node_id} does not exist.",
        )
    except Exception:
        logger.exception("unexpected error fetching placement | node_id=%s", node_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve node placement. Please try again later.",
        )
