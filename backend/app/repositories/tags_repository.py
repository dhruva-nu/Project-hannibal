from sqlalchemy.orm import Session

from app.models.tags_model import Tags


class TagsRepository:
    def __init__(self, db: Session) -> None:
        self._db = db

    def get_all(self) -> list[Tags]:
        return self._db.query(Tags).all()

    def get_by_id(self, tag_id: int) -> Tags | None:
        return self._db.query(Tags).filter(Tags.id == tag_id).first()

    def create(self, name: str, description: str) -> Tags:
        tag = Tags(name=name, description=description)
        self._db.add(tag)
        self._db.commit()
        self._db.refresh(tag)
        return tag

    def update(self, tag: Tags, name: str | None, description: str | None) -> Tags:
        if name is not None:
            tag.name = name
        if description is not None:
            tag.description = description
        self._db.commit()
        self._db.refresh(tag)
        return tag

    def delete(self, tag: Tags) -> None:
        self._db.delete(tag)
        self._db.commit()
