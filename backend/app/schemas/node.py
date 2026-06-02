from typing import Optional

from pydantic import BaseModel


class NodeResponse(BaseModel):
    id: str
    type: str
    label: str
    parent_id: Optional[str] = None
    default_x: Optional[float] = None
    default_y: Optional[float] = None
    default_w: Optional[float] = None
    linked_node_ids: list[str] = []
    model_config = {"from_attributes": True}


class NodePlacementResponse(BaseModel):
    nodes: list[NodeResponse]
