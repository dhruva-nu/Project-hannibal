import httpx

from app.core.config import settings


class DslService:
    def __init__(self) -> None:
        self._base_url = settings.dsl_service_url

    async def translate(self, dsl: str, language: str) -> str:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self._base_url}/translate",
                json={"dsl": dsl, "language": language},
                timeout=10.0,
            )
            response.raise_for_status()
            return response.json()["code"]
