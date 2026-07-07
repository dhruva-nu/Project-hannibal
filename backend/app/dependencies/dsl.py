from typing import Annotated

from fastapi import Depends

from app.services.dsl_service import DslService


def get_dsl_service() -> DslService:
    return DslService()


DslServiceDep = Annotated[DslService, Depends(get_dsl_service)]
