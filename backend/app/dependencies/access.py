from app.dependencies.auth import CurrentUser


def require_admin(payload: CurrentUser) -> dict:
    # TODO: raise 403 when payload["role"] != "admin"
    return payload


def require_quota(payload: CurrentUser) -> dict:
    # TODO: raise 429 when user quota is exhausted
    return payload
