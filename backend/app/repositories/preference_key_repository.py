from sqlalchemy.orm import Session

from app.models.preference_key_model import PreferenceKey


class PreferenceKeyRepository:
    def __init__(self, db: Session) -> None:
        self._db = db

    def get_by_key(self, key: str) -> PreferenceKey | None:
        return self._db.query(PreferenceKey).filter(PreferenceKey.key == key).first()

    def list_all(self) -> list[PreferenceKey]:
        return self._db.query(PreferenceKey).all()

    def create(self, key: str, description: str) -> PreferenceKey:
        row = PreferenceKey(key=key, description=description)
        self._db.add(row)
        self._db.commit()
        self._db.refresh(row)
        return row
