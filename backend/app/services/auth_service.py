import hmac
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import bcrypt
import httpx
from jose import JWTError, jwt

from app.core.config import settings
from app.repositories.refresh_token_repository import RefreshTokenRepository
from app.repositories.user_repository import UserRepository
from app.schemas.auth import UserResponse

_GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
_GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
_GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"


class AuthService:
    def __init__(
        self, repository: UserRepository, refresh_repository: RefreshTokenRepository
    ) -> None:
        self._repository = repository
        self._refresh_repository = refresh_repository

    def register(self, email: str, password: str) -> UserResponse:
        if self._repository.get_by_email(email):
            raise ValueError("Email already registered")
        hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
        user = self._repository.create(email=email, hashed_password=hashed)
        return UserResponse.model_validate(user)

    def login(self, email: str, password: str) -> tuple[str, str, UserResponse]:
        user = self._repository.get_by_email(email)
        if not user or user.hashed_password is None:
            raise ValueError("Invalid credentials")
        if not bcrypt.checkpw(password.encode(), user.hashed_password.encode()):
            raise ValueError("Invalid credentials")

        return self._issue_tokens(user)

    def refresh(self, refresh_token: str) -> str:
        try:
            payload = jwt.decode(
                refresh_token, settings.secret_key, algorithms=[settings.jwt_algorithm]
            )
        except JWTError:
            raise ValueError("Invalid or expired token")

        jti = payload.get("jti")
        if not jti:
            raise ValueError("Invalid or expired token")

        record = self._refresh_repository.get_by_jti(jti)
        if record is None or record.revoked:
            raise ValueError("Invalid or expired token")
        if record.expires_at < datetime.now(timezone.utc):
            raise ValueError("Invalid or expired token")

        return self._create_access_token(
            {"sub": payload["sub"], "email": payload["email"], "role": payload["role"]}
        )

    def logout(self, refresh_token: str) -> None:
        try:
            payload = jwt.decode(
                refresh_token, settings.secret_key, algorithms=[settings.jwt_algorithm]
            )
            jti = payload.get("jti")
            if jti:
                self._refresh_repository.revoke_by_jti(jti)
        except JWTError:
            pass

    def get_user_by_email(self, email: str) -> UserResponse | None:
        user = self._repository.get_by_email(email)
        if not user:
            return None
        return UserResponse.model_validate(user)

    def verify_token(self, token: str) -> dict:
        try:
            return jwt.decode(
                token, settings.secret_key, algorithms=[settings.jwt_algorithm]
            )
        except JWTError:
            raise ValueError("Invalid or expired token")

    def generate_oauth_state(self) -> str:
        """Return a random state token and its HMAC signature, joined by '.'."""
        token = secrets.token_urlsafe(32)
        sig = hmac.new(
            settings.secret_key.encode(), token.encode(), "sha256"
        ).hexdigest()
        return f"{token}.{sig}"

    def verify_oauth_state(self, state: str) -> bool:
        parts = state.split(".", 1)
        if len(parts) != 2:
            return False
        token, sig = parts
        expected = hmac.new(
            settings.secret_key.encode(), token.encode(), "sha256"
        ).hexdigest()
        return hmac.compare_digest(sig, expected)

    def get_google_auth_url(self, state: str) -> str:
        params = urlencode(
            {
                "client_id": settings.google_client_id,
                "redirect_uri": settings.google_redirect_uri,
                "response_type": "code",
                "scope": "openid email profile",
                "state": state,
                "access_type": "offline",
                "prompt": "select_account",
            }
        )
        return f"{_GOOGLE_AUTH_URL}?{params}"

    def handle_google_callback(self, code: str) -> tuple[str, str, UserResponse]:
        with httpx.Client() as client:
            token_resp = client.post(
                _GOOGLE_TOKEN_URL,
                data={
                    "code": code,
                    "client_id": settings.google_client_id,
                    "client_secret": settings.google_client_secret,
                    "redirect_uri": settings.google_redirect_uri,
                    "grant_type": "authorization_code",
                },
            )
        token_resp.raise_for_status()
        token_data = token_resp.json()
        google_access_token: str | None = token_data.get("access_token")
        if not google_access_token:
            raise ValueError("Google token exchange returned no access token")

        with httpx.Client() as client:
            info_resp = client.get(
                _GOOGLE_USERINFO_URL,
                headers={"Authorization": f"Bearer {google_access_token}"},
            )
        info_resp.raise_for_status()
        info = info_resp.json()

        email: str | None = info.get("email")
        oauth_id: str | None = info.get("id")
        if not email or not oauth_id:
            raise ValueError("Google user info response missing required fields")

        user = self._repository.get_or_create_oauth_user(
            email=email, provider="google", oauth_id=oauth_id
        )

        return self._issue_tokens(user)

    def _issue_tokens(self, user) -> tuple[str, str, "UserResponse"]:
        """Create access + refresh tokens, persist the refresh token, and return both with the user response."""
        access_token = self._create_access_token(
            {"sub": str(user.id), "email": user.email, "role": user.role}
        )
        refresh_token, jti = self._create_refresh_token(user.id, user.email, user.role)
        expires_at = datetime.now(timezone.utc) + timedelta(
            days=settings.refresh_token_expire_days
        )
        self._refresh_repository.create(user_id=user.id, jti=jti, expires_at=expires_at)
        return access_token, refresh_token, UserResponse.model_validate(user)

    def _create_access_token(self, jwt_claims: dict) -> str:
        payload = jwt_claims.copy()
        payload["exp"] = datetime.now(timezone.utc) + timedelta(
            minutes=settings.access_token_expire_minutes
        )
        return jwt.encode(
            payload, settings.secret_key, algorithm=settings.jwt_algorithm
        )

    def _create_refresh_token(
        self, user_id: int, email: str, role: str
    ) -> tuple[str, str]:
        jti = str(uuid.uuid4())
        payload = {
            "sub": str(user_id),
            "email": email,
            "role": role,
            "jti": jti,
            "exp": datetime.now(timezone.utc)
            + timedelta(days=settings.refresh_token_expire_days),
        }
        token = jwt.encode(
            payload, settings.secret_key, algorithm=settings.jwt_algorithm
        )
        return token, jti
