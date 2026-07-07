from typing import Annotated

from fastapi import Depends

from app.dependencies.db import DbSession
from app.repositories.rce_package_repository import RcePackageRepository
from app.services.package_search.package_search_service import PackageSearchService


def get_package_search_service(db: DbSession) -> PackageSearchService:
    return PackageSearchService(repository=RcePackageRepository(db=db))


PackageSearchServiceDep = Annotated[
    PackageSearchService, Depends(get_package_search_service)
]
