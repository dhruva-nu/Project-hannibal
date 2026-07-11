from sqlalchemy.orm import Session

from app.models.feature_flag_model import FeatureFlag


class FeatureFlagRepository:
    def __init__(self, db: Session) -> None:
        self._db = db

    def get_all(self) -> list[FeatureFlag]:
        return self._db.query(FeatureFlag).all()

    def get_by_key(self, key: str) -> FeatureFlag | None:
        return self._db.query(FeatureFlag).filter(FeatureFlag.key == key).first()

    def create(
        self,
        key: str,
        description: str,
        enabled: bool,
        rollout_percentage: int,
        target_roles: list[str] | None,
    ) -> FeatureFlag:
        flag = FeatureFlag(
            key=key,
            description=description,
            enabled=enabled,
            rollout_percentage=rollout_percentage,
            target_roles=target_roles,
        )
        self._db.add(flag)
        self._db.commit()
        self._db.refresh(flag)
        return flag

    def update(
        self,
        flag: FeatureFlag,
        description: str | None,
        enabled: bool | None,
        rollout_percentage: int | None,
        target_roles: list[str] | None,
        clear_target_roles: bool,
    ) -> FeatureFlag:
        if description is not None:
            flag.description = description
        if enabled is not None:
            flag.enabled = enabled
        if rollout_percentage is not None:
            flag.rollout_percentage = rollout_percentage
        if target_roles is not None:
            flag.target_roles = target_roles
        elif clear_target_roles:
            flag.target_roles = None
        self._db.commit()
        self._db.refresh(flag)
        return flag

    def delete(self, flag: FeatureFlag) -> None:
        self._db.delete(flag)
        self._db.commit()
