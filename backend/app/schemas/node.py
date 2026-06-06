from pydantic import BaseModel


class NodeResponse(BaseModel):
    id: str
    type: str
    label: str
    parent_id: str | None = None
    default_x: float | None = None
    default_y: float | None = None
    default_w: float | None = None
    linked_node_ids: list[str] = []
    model_config = {"from_attributes": True}


class NodePlacementResponse(BaseModel):
    nodes: list[NodeResponse]
