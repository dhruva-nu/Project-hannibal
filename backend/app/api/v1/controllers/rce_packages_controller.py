import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.dependencies.rce_packages import get_package_search_service
from app.schemas.rce_packages import PackageVerifyResponse
from app.services.package_search.package_search_service import PackageSearchService

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/search", response_model=list[str])
def search_packages(
    language: str = Query(...),
    q: str = Query(...),
    service: PackageSearchService = Depends(get_package_search_service),
) -> list[str]:
    try:
        return service.search(language, q)
    except ValueError as error:
        logger.warning("package search rejected | language=%s q=%r", language, q)
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error))
    except Exception:
        logger.exception("package search failed | language=%s q=%r", language, q)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to search packages. Please try again later.",
        )


@router.get("/verify", response_model=PackageVerifyResponse)
def verify_package(
    language: str = Query(...),
    name: str = Query(...),
    service: PackageSearchService = Depends(get_package_search_service),
) -> PackageVerifyResponse:
    try:
        return service.verify(language, name)
    except ValueError as error:
        logger.warning("package verify rejected | language=%s name=%r", language, name)
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error))
    except Exception:
        logger.exception("package verify failed | language=%s name=%r", language, name)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to verify package. Please try again later.",
        )
