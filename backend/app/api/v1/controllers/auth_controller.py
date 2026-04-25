from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.dependencies.auth import get_auth_service, require_auth
from app.schemas.auth import LoginRequest, RegisterRequest, TokenResponse, UserResponse
from app.services.auth_service import AuthService

router = APIRouter()


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def register(
    body: RegisterRequest,
    auth_service: AuthService = Depends(get_auth_service),
) -> UserResponse:
    if len(body.password) < 8:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Password must be at least 8 characters",
        )
    try:
        return auth_service.register(email=body.email, password=body.password)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))


@router.post("/login", response_model=TokenResponse)
def login(
    body: LoginRequest,
    auth_service: AuthService = Depends(get_auth_service),
) -> TokenResponse:
    try:
        return auth_service.login(email=body.email, password=body.password)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    _: dict = Depends(require_auth),
) -> Response:
    # JWT is stateless; client should discard the token.
    # Extend this endpoint to blacklist tokens if needed.
    return Response(status_code=status.HTTP_204_NO_CONTENT)
