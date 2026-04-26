import uuid
from datetime import datetime, timedelta, timezone

import bcrypt
from jose import JWTError, jwt

from app.core.config import settings
from app.repositories.refresh_token_repository import RefreshTokenRepository
from app.repositories.user_repository import UserRepository
from app.schemas.auth import UserResponse


class AuthService:
    def __init__(self, repository: UserRepository, refresh_repository: RefreshTokenRepository) -> None:
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

        access_token = self._create_access_token({"sub": str(user.id), "email": user.email})
        refresh_token, jti = self._create_refresh_token(user.id, user.email)

        expires_at = datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expire_days)
        self._refresh_repository.create(user_id=user.id, jti=jti, expires_at=expires_at)

        return access_token, refresh_token, UserResponse.model_validate(user)

    def refresh(self, refresh_token: str) -> str:
        try:
            payload = jwt.decode(refresh_token, settings.secret_key, algorithms=[settings.jwt_algorithm])
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

        return self._create_access_token({"sub": payload["sub"], "email": payload["email"]})

    def logout(self, refresh_token: str) -> None:
        try:
            payload = jwt.decode(refresh_token, settings.secret_key, algorithms=[settings.jwt_algorithm])
            jti = payload.get("jti")
            if jti:
                self._refresh_repository.revoke_by_jti(jti)
        except JWTError:
            pass

    def verify_token(self, token: str) -> dict:
        try:
            return jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])
        except JWTError:
            raise ValueError("Invalid or expired token")

    def _create_access_token(self, data: dict) -> str:
        payload = data.copy()
        payload["exp"] = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
        return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)

    def _create_refresh_token(self, user_id: int, email: str) -> tuple[str, str]:
        jti = str(uuid.uuid4())
        payload = {
            "sub": str(user_id),
            "email": email,
            "jti": jti,
            "exp": datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expire_days),
        }
        token = jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)
        return token, jti
