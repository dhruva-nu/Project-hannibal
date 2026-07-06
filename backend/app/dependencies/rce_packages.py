from fastapi import Depends
from sqlalchemy.orm import Session

from app.dependencies.db import get_db
from app.repositories.rce_package_repository import RcePackageRepository
from app.services.package_search.package_search_service import PackageSearchService


def get_package_search_service(db: Session = Depends(get_db)) -> PackageSearchService:
    return PackageSearchService(repository=RcePackageRepository(db=db))
