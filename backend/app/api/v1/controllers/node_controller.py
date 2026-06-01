import logging

from fastapi import APIRouter, Depends, HTTPException, status

from app.dependencies.node import get_node_service
from app.schemas.node import NodePlacementResponse
from app.services.node_service import NodeService

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/{node_id}/placement", response_model=NodePlacementResponse)
async def get_node_placement(
    node_id: str,
    service: NodeService = Depends(get_node_service),
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
        logger.exception("unexpected error fetching node placement | node_id=%s", node_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve node placement. Please try again later.",
        )
