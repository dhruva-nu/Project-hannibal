from typing import Annotated

from fastapi import Depends, HTTPException, Request, status

from app.dependencies.db import DbSession
from app.repositories.refresh_token_repository import RefreshTokenRepository
from app.repositories.user_repository import UserRepository
from app.services.auth_service import AuthService


def get_auth_service(db: DbSession) -> AuthService:
    return AuthService(
        repository=UserRepository(db=db),
        refresh_repository=RefreshTokenRepository(db=db),
    )


AuthServiceDep = Annotated[AuthService, Depends(get_auth_service)]


def require_auth(
    request: Request,
    auth_service: AuthServiceDep,
) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        header = request.headers.get("Authorization", "")
        if header.startswith("Bearer "):
            token = header[len("Bearer ") :]
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )
    try:
        return auth_service.verify_token(token)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token"
        )


CurrentUser = Annotated[dict, Depends(require_auth)]


def require_admin(payload: CurrentUser) -> dict:
    if payload.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required"
        )
    return payload


AdminUser = Annotated[dict, Depends(require_admin)]
