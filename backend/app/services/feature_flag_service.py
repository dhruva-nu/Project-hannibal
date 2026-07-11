import hashlib

from app.models.feature_flag_model import FeatureFlag
from app.repositories.feature_flag_repository import FeatureFlagRepository
from app.schemas.feature_flag import FeatureFlagResponse, FeatureFlagUpdate

_BUCKETS = 100


def _bucket(key: str, user_id: int) -> int:
    digest = hashlib.sha256(f"{key}:{user_id}".encode()).hexdigest()
    return int(digest, 16) % _BUCKETS


def _is_enabled_for(flag: FeatureFlag, user_id: int, role: str) -> bool:
    if not flag.enabled:
        return False
    if flag.target_roles and role in flag.target_roles:
        return True
    return _bucket(flag.key, user_id) < flag.rollout_percentage


class FeatureFlagService:
    def __init__(self, repository: FeatureFlagRepository) -> None:
        self._repository = repository

    def evaluate_for_user(self, user_id: int, role: str) -> dict[str, bool]:
        return {
            flag.key: _is_enabled_for(flag, user_id, role)
            for flag in self._repository.get_all()
        }

    def list_flags(self) -> list[FeatureFlagResponse]:
        return [
            FeatureFlagResponse.model_validate(f) for f in self._repository.get_all()
        ]

    def get_flag(self, key: str) -> FeatureFlagResponse:
        flag = self._repository.get_by_key(key)
        if not flag:
            raise ValueError(f"Feature flag {key!r} not found")
        return FeatureFlagResponse.model_validate(flag)

    def create_flag(
        self,
        key: str,
        description: str,
        enabled: bool,
        rollout_percentage: int,
        target_roles: list[str] | None,
    ) -> FeatureFlagResponse:
        if self._repository.get_by_key(key):
            raise ValueError(f"Feature flag {key!r} already exists")
        flag = self._repository.create(
            key=key,
            description=description,
            enabled=enabled,
            rollout_percentage=rollout_percentage,
            target_roles=target_roles,
        )
        return FeatureFlagResponse.model_validate(flag)

    def update_flag(self, key: str, body: FeatureFlagUpdate) -> FeatureFlagResponse:
        flag = self._repository.get_by_key(key)
        if not flag:
            raise ValueError(f"Feature flag {key!r} not found")
        clear_target_roles = (
            "target_roles" in body.model_fields_set and body.target_roles is None
        )
        flag = self._repository.update(
            flag,
            description=body.description,
            enabled=body.enabled,
            rollout_percentage=body.rollout_percentage,
            target_roles=body.target_roles,
            clear_target_roles=clear_target_roles,
        )
        return FeatureFlagResponse.model_validate(flag)

    def delete_flag(self, key: str) -> None:
        flag = self._repository.get_by_key(key)
        if not flag:
            raise ValueError(f"Feature flag {key!r} not found")
        self._repository.delete(flag)
