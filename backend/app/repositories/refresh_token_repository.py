from datetime import datetime

from sqlalchemy.orm import Session

from app.models.refresh_token import RefreshToken


class RefreshTokenRepository:
    def __init__(self, db: Session) -> None:
        self._db = db

    def create(self, user_id: int, jti: str, expires_at: datetime) -> RefreshToken:
        token = RefreshToken(user_id=user_id, jti=jti, expires_at=expires_at)
        self._db.add(token)
        self._db.commit()
        self._db.refresh(token)
        return token

    def get_by_jti(self, jti: str) -> RefreshToken | None:
        return self._db.query(RefreshToken).filter(RefreshToken.jti == jti).first()

    def revoke_by_jti(self, jti: str) -> None:
        token = self.get_by_jti(jti)
        if token:
            token.revoked = True
            self._db.commit()
