from fastapi import Depends

from app.dependencies.auth import require_auth


def require_admin(payload: dict = Depends(require_auth)) -> dict:
    # TODO: raise 403 when payload["role"] != "admin"
    return payload


def require_quota(payload: dict = Depends(require_auth)) -> dict:
    # TODO: raise 429 when user quota is exhausted
    return payload
