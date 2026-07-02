"""Unit tests for EmbeddingService — GoogleGenerativeAIEmbeddings is mocked.

No real network calls and no real Google client construction: the embedder
factory is patched so every test drives the provider-chain / fallback logic.
"""

import os
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

import app.services.embedding_service as es
from app.core.google_genai import google_api_key
from app.models.course_embedding_model import EMBEDDING_DIM
from app.services.embedding_service import (
    EmbeddingService,
    _build_embedder,
)


def fake_settings(
    *, llm_provider, vertex_ai_key="", gemini_api_key="", embedding_model="model-x"
):
    """Settings is a frozen dataclass — swap the whole object, not a field."""
    return patch.object(
        es,
        "settings",
        SimpleNamespace(
            llm_provider=llm_provider,
            vertex_ai_key=vertex_ai_key,
            gemini_api_key=gemini_api_key,
            embedding_model=embedding_model,
        ),
    )


@pytest.fixture
def fake_embedder():
    """A stand-in GoogleGenerativeAIEmbeddings with both embed methods."""
    embedder = MagicMock()
    embedder.embed_documents.return_value = [[0.1, 0.2], [0.3, 0.4]]
    embedder.embed_query.return_value = [0.5, 0.6]
    return embedder


class TestGoogleApiKeyContext:
    def test_restores_previous_key(self):
        os.environ["GOOGLE_API_KEY"] = "original"
        with google_api_key("temp"):
            assert os.environ["GOOGLE_API_KEY"] == "temp"
        assert os.environ["GOOGLE_API_KEY"] == "original"

    def test_pops_key_when_absent_before(self):
        os.environ.pop("GOOGLE_API_KEY", None)
        with google_api_key("temp"):
            assert os.environ["GOOGLE_API_KEY"] == "temp"
        assert "GOOGLE_API_KEY" not in os.environ

    def test_restores_key_on_exception(self):
        os.environ["GOOGLE_API_KEY"] = "original"
        with pytest.raises(ValueError):
            with google_api_key("temp"):
                raise ValueError("boom")
        assert os.environ["GOOGLE_API_KEY"] == "original"


class TestBuildEmbedder:
    def test_constructs_with_pinned_key_and_dim(self):
        with patch.object(es, "GoogleGenerativeAIEmbeddings") as MockEmb:
            with fake_settings(llm_provider="vertex", embedding_model="model-x"):
                _build_embedder("k", vertexai=True, task_type=es._DOCUMENT_TASK)

        MockEmb.assert_called_once_with(
            model="model-x",
            google_api_key="k",
            vertexai=True,
            task_type=es._DOCUMENT_TASK,
            output_dimensionality=EMBEDDING_DIM,
        )


class TestEmbedDocuments:
    def test_returns_vectors_from_primary(self, fake_embedder):
        with patch.object(es, "_build_embedder", return_value=fake_embedder):
            with fake_settings(llm_provider="vertex", vertex_ai_key="vk"):
                result = EmbeddingService().embed_documents(["a", "b"])

        assert result == [[0.1, 0.2], [0.3, 0.4]]
        fake_embedder.embed_documents.assert_called_once_with(["a", "b"])


class TestEmbedQuery:
    def test_returns_single_vector(self, fake_embedder):
        with patch.object(es, "_build_embedder", return_value=fake_embedder):
            with fake_settings(llm_provider="gemini", gemini_api_key="gk"):
                result = EmbeddingService().embed_query("doubt?")

        assert result == [0.5, 0.6]
        fake_embedder.embed_query.assert_called_once_with("doubt?")

    def test_chain_is_cached_per_task(self, fake_embedder):
        with patch.object(
            es, "_build_embedder", return_value=fake_embedder
        ) as mock_build:
            with fake_settings(llm_provider="gemini", gemini_api_key="gk"):
                service = EmbeddingService()
                service.embed_query("first")
                service.embed_query("second")

        assert mock_build.call_count == 1


class TestProviderFallback:
    def test_falls_back_to_second_provider(self):
        primary = MagicMock()
        primary.embed_query.side_effect = RuntimeError("primary down")
        fallback = MagicMock()
        fallback.embed_query.return_value = [9.0]

        with patch.object(es, "_build_embedder", side_effect=[primary, fallback]):
            with fake_settings(
                llm_provider="vertex", vertex_ai_key="vk", gemini_api_key="gk"
            ):
                result = EmbeddingService().embed_query("q")

        assert result == [9.0]
        primary.embed_query.assert_called_once()
        fallback.embed_query.assert_called_once()

    def test_raises_when_all_providers_fail(self):
        broken = MagicMock()
        broken.embed_query.side_effect = RuntimeError("down")

        with patch.object(es, "_build_embedder", return_value=broken):
            with fake_settings(llm_provider="vertex", vertex_ai_key="vk"):
                with pytest.raises(
                    RuntimeError, match="All embedding providers failed"
                ):
                    EmbeddingService().embed_query("q")


class TestBuildChainErrors:
    def test_rejects_unknown_provider(self):
        with fake_settings(llm_provider="openai"):
            with pytest.raises(RuntimeError, match="LLM_PROVIDER must be"):
                EmbeddingService().embed_query("q")

    def test_raises_when_no_keys_configured(self):
        with patch.object(es, "_build_embedder", return_value=MagicMock()):
            with fake_settings(llm_provider="vertex"):
                with pytest.raises(RuntimeError, match="Neither VERTEX_AI_KEY"):
                    EmbeddingService().embed_query("q")

    def test_chain_order_prefers_configured_provider(self, fake_embedder):
        calls = []

        def record(key, *, vertexai, task_type):
            calls.append((key, vertexai))
            return fake_embedder

        with patch.object(es, "_build_embedder", side_effect=record):
            with fake_settings(
                llm_provider="gemini", vertex_ai_key="vk", gemini_api_key="gk"
            ):
                EmbeddingService().embed_query("q")

        # gemini is primary -> built first, vertex fallback second
        assert calls == [("gk", False), ("vk", True)]
