from typing import Annotated

from fastapi import Depends

from app.dependencies.db import DbSession
from app.repositories.course_repository import CourseRepository
from app.repositories.progress_repository import ProgressRepository
from app.services.progress_service import ProgressService


def get_progress_service(db: DbSession) -> ProgressService:
    return ProgressService(
        repository=ProgressRepository(db=db),
        course_repository=CourseRepository(db=db),
    )


ProgressServiceDep = Annotated[ProgressService, Depends(get_progress_service)]
