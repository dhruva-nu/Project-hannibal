import uuid
from typing import Literal, Optional

from beanie import Document
from pydantic import Field


NodeType = Literal["component", "service", "module"]


class Node(Document):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    type: NodeType
    label: str
    parent_id: Optional[str] = None
    linked_node_ids: list[str] = Field(default_factory=list)
    default_x: Optional[float] = None
    default_y: Optional[float] = None
    default_w: Optional[float] = None

    class Settings:
        name = "nodes"
