from typing import Annotated

from fastapi import Depends

from app.dependencies.db import DbSession
from app.repositories.tags_repository import TagsRepository
from app.services.tags_service import TagsService


def get_tags_service(db: DbSession) -> TagsService:
    return TagsService(repository=TagsRepository(db=db))


TagsServiceDep = Annotated[TagsService, Depends(get_tags_service)]
