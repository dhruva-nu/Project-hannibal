from typing import Literal, Optional

from pydantic import BaseModel


NodeType = Literal["component", "service", "module"]


class NodeResponse(BaseModel):
    model_config = {"from_attributes": True}
    id: str
    type: NodeType
    label: str
    parent_id: Optional[str] = None
    linked_node_ids: list[str] = []
    default_x: Optional[float] = None
    default_y: Optional[float] = None
    default_w: Optional[float] = None


class NodePlacementResponse(BaseModel):
    nodes: list[NodeResponse]
