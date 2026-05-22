"""Unit tests for DslService — httpx is fully mocked."""
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.services.dsl_service import DslService


class TestTranslate:
    def test_returns_translated_code(self):
        async def run():
            mock_response = MagicMock()
            mock_response.json.return_value = {"code": "console.log('hello')"}
            mock_client = AsyncMock()
            mock_client.post = AsyncMock(return_value=mock_response)

            with patch("app.services.dsl_service.httpx.AsyncClient") as MockClient:
                MockClient.return_value.__aenter__ = AsyncMock(return_value=mock_client)
                MockClient.return_value.__aexit__ = AsyncMock(return_value=False)

                service = DslService()
                result = await service.translate("def f(): pass", "javascript")

            assert result == "console.log('hello')"
            mock_client.post.assert_called_once_with(
                f"{service._base_url}/translate",
                json={"dsl": "def f(): pass", "language": "javascript"},
                timeout=5.0,
            )
            mock_response.raise_for_status.assert_called_once()

        asyncio.run(run())

    def test_raises_on_http_error(self):
        async def run():
            mock_client = AsyncMock()
            mock_response = MagicMock()
            mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
                "502", request=MagicMock(), response=MagicMock()
            )
            mock_client.post = AsyncMock(return_value=mock_response)

            with patch("app.services.dsl_service.httpx.AsyncClient") as MockClient:
                MockClient.return_value.__aenter__ = AsyncMock(return_value=mock_client)
                MockClient.return_value.__aexit__ = AsyncMock(return_value=False)

                with pytest.raises(httpx.HTTPStatusError):
                    await DslService().translate("def f(): pass", "python")

        asyncio.run(run())
