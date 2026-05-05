from fastapi import Depends
from sqlalchemy.orm import Session

from app.dependencies.db import get_db
from app.repositories.tags_repository import TagsRepository
from app.services.tags_service import TagsService


def get_tags_service(db: Session = Depends(get_db)) -> TagsService:
    return TagsService(repository=TagsRepository(db=db))
