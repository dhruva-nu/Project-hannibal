from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse

from app.core.config import settings
from app.dependencies.auth import get_auth_service, require_auth
from app.schemas.auth import LoginRequest, RegisterRequest, UserResponse
from app.services.auth_service import AuthService

router = APIRouter()

_ACCESS_COOKIE = "access_token"
_REFRESH_COOKIE = "refresh_token"


def _set_auth_cookies(response: Response, access_token: str, refresh_token: str) -> None:
    response.set_cookie(
        key=_ACCESS_COOKIE,
        value=access_token,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        max_age=settings.access_token_expire_minutes * 60,
    )
    response.set_cookie(
        key=_REFRESH_COOKIE,
        value=refresh_token,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        max_age=settings.refresh_token_expire_days * 86400,
    )


def _clear_auth_cookies(response: Response) -> None:
    response.delete_cookie(_ACCESS_COOKIE)
    response.delete_cookie(_REFRESH_COOKIE)


@router.get("/me", response_model=UserResponse)
def me(
    payload: dict = Depends(require_auth),
    auth_service: AuthService = Depends(get_auth_service),
) -> UserResponse:
    user = auth_service.get_user_by_email(payload["email"])
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


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


@router.post("/login", response_model=UserResponse)
def login(
    body: LoginRequest,
    response: Response,
    auth_service: AuthService = Depends(get_auth_service),
) -> UserResponse:
    try:
        access_token, refresh_token, user = auth_service.login(email=body.email, password=body.password)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )
    _set_auth_cookies(response, access_token, refresh_token)
    return user


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    request: Request,
    response: Response,
    auth_service: AuthService = Depends(get_auth_service),
) -> Response:
    rt = request.cookies.get(_REFRESH_COOKIE)
    if rt:
        try:
            auth_service.logout(rt)
        except Exception:
            pass
    _clear_auth_cookies(response)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/refresh")
def refresh(
    request: Request,
    response: Response,
    auth_service: AuthService = Depends(get_auth_service),
) -> dict:
    rt = request.cookies.get(_REFRESH_COOKIE)
    if not rt:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing refresh token")
    try:
        new_access = auth_service.refresh(rt)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    response.set_cookie(
        key=_ACCESS_COOKIE,
        value=new_access,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        max_age=settings.access_token_expire_minutes * 60,
    )
    return {"ok": True}


_OAUTH_STATE_COOKIE = "oauth_state"


@router.get("/google")
def google_login(
    response: RedirectResponse = None,  # type: ignore[assignment]
    auth_service: AuthService = Depends(get_auth_service),
) -> RedirectResponse:
    state = auth_service.generate_oauth_state()
    redirect = RedirectResponse(url=auth_service.get_google_auth_url(state))
    redirect.set_cookie(
        key=_OAUTH_STATE_COOKIE,
        value=state,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        max_age=300,
    )
    return redirect


@router.get("/google/callback")
def google_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    auth_service: AuthService = Depends(get_auth_service),
) -> RedirectResponse:
    if error or not code or not state:
        return RedirectResponse(url=f"{settings.frontend_origin}/login?error=oauth_cancelled")

    stored_state = request.cookies.get(_OAUTH_STATE_COOKIE)
    if not stored_state or stored_state != state or not auth_service.verify_oauth_state(state):
        return RedirectResponse(url=f"{settings.frontend_origin}/login?error=oauth_state_mismatch")

    try:
        access_token, refresh_token, _user = auth_service.handle_google_callback(code)
    except Exception as exc:
        import logging
        logging.getLogger(__name__).exception("Google OAuth callback failed: %s", exc)
        return RedirectResponse(url=f"{settings.frontend_origin}/login?error=oauth_failed")

    redirect = RedirectResponse(url=f"{settings.frontend_origin}/home")
    _set_auth_cookies(redirect, access_token, refresh_token)
    redirect.delete_cookie(_OAUTH_STATE_COOKIE)
    return redirect
