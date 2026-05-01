from fastapi import APIRouter

from app.api.v1.controllers.auth_controller import router as auth_router
from app.api.v1.controllers.health_controller import router as health_router
from app.api.v1.controllers.rce_controller import router as rce_router

api_router = APIRouter()
api_router.include_router(health_router, prefix="/health", tags=["health"])
api_router.include_router(auth_router, prefix="/auth", tags=["auth"])
api_router.include_router(rce_router, prefix="/rce", tags=["Remote Code Execution"])
