import logging

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse

from app.core.config import settings
from app.dependencies.auth import get_auth_service
from app.schemas.auth import LoginRequest, RegisterRequest, UserResponse
from app.services.auth_service import AuthService

router = APIRouter()
logger = logging.getLogger(__name__)

_ACCESS_COOKIE = "access_token"
_REFRESH_COOKIE = "refresh_token"
_OAUTH_STATE_COOKIE = "oauth_state"


def _write_httponly_cookie(response: Response, key: str, value: str, max_age: int) -> None:
    response.set_cookie(
        key=key,
        value=value,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        max_age=max_age,
    )


def _set_auth_cookies(response: Response, access_token: str, refresh_token: str) -> None:
    _write_httponly_cookie(response, _ACCESS_COOKIE, access_token, settings.access_token_expire_minutes * 60)
    _write_httponly_cookie(response, _REFRESH_COOKIE, refresh_token, settings.refresh_token_expire_days * 86400)


def _clear_auth_cookies(response: Response) -> None:
    response.delete_cookie(_ACCESS_COOKIE)
    response.delete_cookie(_REFRESH_COOKIE)


def _login_error_redirect(error_code: str) -> RedirectResponse:
    return RedirectResponse(url=f"{settings.frontend_origin}/login?error={error_code}")


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
            logger.warning("Token revocation failed during logout; proceeding to clear cookies")
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
        new_access_token = auth_service.refresh(rt)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    _write_httponly_cookie(response, _ACCESS_COOKIE, new_access_token, settings.access_token_expire_minutes * 60)
    return {"ok": True}


@router.get("/google")
def google_login(
    response: RedirectResponse = None,  # type: ignore[assignment]
    auth_service: AuthService = Depends(get_auth_service),
) -> RedirectResponse:
    state = auth_service.generate_oauth_state()
    redirect = RedirectResponse(url=auth_service.get_google_auth_url(state))
    _write_httponly_cookie(redirect, _OAUTH_STATE_COOKIE, state, 300)
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
        return _login_error_redirect("oauth_cancelled")

    stored_state = request.cookies.get(_OAUTH_STATE_COOKIE)
    if not stored_state or stored_state != state or not auth_service.verify_oauth_state(state):
        return _login_error_redirect("oauth_state_mismatch")

    try:
        access_token, refresh_token, _user = auth_service.handle_google_callback(code)
    except Exception:
        logger.exception("Google OAuth callback failed")
        return _login_error_redirect("oauth_failed")

    redirect = RedirectResponse(url=f"{settings.frontend_origin}/home")
    _set_auth_cookies(redirect, access_token, refresh_token)
    redirect.delete_cookie(_OAUTH_STATE_COOKIE)
    return redirect
