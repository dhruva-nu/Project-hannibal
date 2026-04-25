from datetime import datetime, timedelta, timezone

import bcrypt
from jose import JWTError, jwt

from app.core.config import settings
from app.models.user import User
from app.repositories.user_repository import UserRepository
from app.schemas.auth import TokenResponse, UserResponse


class AuthService:
    def __init__(self, repository: UserRepository) -> None:
        self._repository = repository

    def register(self, email: str, password: str) -> UserResponse:
        if self._repository.get_by_email(email):
            raise ValueError("Email already registered")
        hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
        user = self._repository.create(email=email, hashed_password=hashed)
        return UserResponse.model_validate(user)

    def login(self, email: str, password: str) -> TokenResponse:
        user = self._repository.get_by_email(email)
        if not user or not bcrypt.checkpw(password.encode(), user.hashed_password.encode()):
            raise ValueError("Invalid credentials")
        token = self._create_access_token({"sub": str(user.id), "email": user.email})
        return TokenResponse(access_token=token)

    def verify_token(self, token: str) -> dict:
        try:
            return jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])
        except JWTError:
            raise ValueError("Invalid or expired token")

    def _create_access_token(self, data: dict) -> str:
        payload = data.copy()
        payload["exp"] = datetime.now(timezone.utc) + timedelta(
            minutes=settings.access_token_expire_minutes
        )
        return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)
