from app.models.tags_model import Tags
from app.repositories.tags_repository import TagsRepository
from app.schemas.tags import TagResponse


class TagsService:
    def __init__(self, repository: TagsRepository) -> None:
        self._repository = repository

    def list_tags(self) -> list[TagResponse]:
        return [TagResponse.model_validate(t) for t in self._repository.get_all()]

    def get_tag(self, tag_id: int) -> TagResponse:
        tag = self._repository.get_by_id(tag_id)
        if not tag:
            raise ValueError(f"Tag {tag_id} not found")
        return TagResponse.model_validate(tag)

    def create_tag(self, name: str, description: str) -> TagResponse:
        tag = self._repository.create(name=name, description=description)
        return TagResponse.model_validate(tag)

    def update_tag(self, tag_id: int, name: str | None, description: str | None) -> TagResponse:
        tag = self._repository.get_by_id(tag_id)
        if not tag:
            raise ValueError(f"Tag {tag_id} not found")
        tag = self._repository.update(tag, name=name, description=description)
        return TagResponse.model_validate(tag)

    def delete_tag(self, tag_id: int) -> None:
        tag = self._repository.get_by_id(tag_id)
        if not tag:
            raise ValueError(f"Tag {tag_id} not found")
        self._repository.delete(tag)
