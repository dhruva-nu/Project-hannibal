from pydantic import BaseModel


class PackageVerifyResponse(BaseModel):
    """The result of checking whether a single package exists.

    ``exists`` is ``None`` when the registry could not be reached (timeout /
    network error) — the frontend treats that as neutral, not a red squiggle.
    """

    name: str
    exists: bool | None
    in_cache: bool
