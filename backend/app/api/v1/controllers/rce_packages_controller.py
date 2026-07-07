import logging
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status

from app.dependencies.rce_packages import PackageSearchServiceDep
from app.schemas.rce_packages import PackageVerifyResponse

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/search", response_model=list[str])
def search_packages(
    language: Annotated[str, Query(...)],
    q: Annotated[str, Query(...)],
    service: PackageSearchServiceDep,
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
    language: Annotated[str, Query(...)],
    name: Annotated[str, Query(...)],
    service: PackageSearchServiceDep,
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
