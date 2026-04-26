from sqlalchemy.orm import Session

from app.models.user import User


class UserRepository:
    def __init__(self, db: Session) -> None:
        self._db = db

    def get_by_email(self, email: str) -> User | None:
        return self._db.query(User).filter(User.email == email).first()

    def get_by_id(self, user_id: int) -> User | None:
        return self._db.query(User).filter(User.id == user_id).first()

    def create(self, email: str, hashed_password: str | None, provider: str = "local", oauth_id: str | None = None) -> User:
        user = User(email=email, hashed_password=hashed_password, provider=provider, oauth_id=oauth_id)
        self._db.add(user)
        self._db.commit()
        self._db.refresh(user)
        return user
