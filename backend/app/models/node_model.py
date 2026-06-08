from beanie import Document
from pydantic import Field


class Node(Document):
    id: str
    type: str
    label: str
    parent_id: str | None = None
    default_x: float | None = None
    default_y: float | None = None
    default_w: float | None = None
    linked_node_ids: list[str] = Field(default_factory=list)

    class Settings:
        name = "nodes"
