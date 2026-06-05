from fastapi import Depends
from sqlalchemy.orm import Session

from app.dependencies.db import get_db
from app.repositories.course_repository import CourseRepository
from app.repositories.progress_repository import ProgressRepository
from app.services.progress_service import ProgressService


def get_progress_service(db: Session = Depends(get_db)) -> ProgressService:
    return ProgressService(
        repository=ProgressRepository(db=db),
        course_repository=CourseRepository(db=db),
    )
