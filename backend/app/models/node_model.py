from typing import Optional

from beanie import Document
from pydantic import Field


class Node(Document):
    id: str
    type: str
    label: str
    parent_id: Optional[str] = None
    default_x: Optional[float] = None
    default_y: Optional[float] = None
    default_w: Optional[float] = None
    linked_node_ids: list[str] = Field(default_factory=list)

    class Settings:
        name = "nodes"
