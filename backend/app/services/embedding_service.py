"""Build-time embedder for courses, lessons and student doubts.

Offline utility — deliberately not wired into any controller or repository.
It is meant to be driven by the course-build flow and one-off scripts that
populate ``course_embeddings`` / ``lesson_embeddings`` and, at doubt time,
embed a query for similarity search.

Stored content is embedded as ``RETRIEVAL_DOCUMENT`` and doubts as
``RETRIEVAL_QUERY`` so both sides match the asymmetric retrieval objective.
Provider selection mirrors the tutor: ``LLM_PROVIDER`` chooses the primary
(Vertex or Gemini) and the other is the fallback. Output dimension is pinned
to ``EMBEDDING_DIM`` so vectors always fit the ``Vector(EMBEDDING_DIM)`` columns.
"""

from langchain_google_genai import GoogleGenerativeAIEmbeddings

from app.core.config import settings
from app.core.google_genai import google_api_key
from app.models.course_embedding_model import EMBEDDING_DIM

_VERTEX = "vertex"
_GEMINI = "gemini"
_DOCUMENT_TASK = "RETRIEVAL_DOCUMENT"
_QUERY_TASK = "RETRIEVAL_QUERY"


def _build_embedder(
    key: str, *, vertexai: bool, task_type: str
) -> GoogleGenerativeAIEmbeddings:
    with google_api_key(key):
        return GoogleGenerativeAIEmbeddings(
            model=settings.embedding_model,
            google_api_key=key,
            vertexai=vertexai,
            task_type=task_type,
            output_dimensionality=EMBEDDING_DIM,
        )


class EmbeddingService:
    """Embeds text via Google embeddings with Vertex/Gemini fallback."""

    # provider -> (api key, vertexai flag)
    _PROVIDER_SPECS = {
        _VERTEX: lambda: (settings.vertex_ai_key, True),
        _GEMINI: lambda: (settings.gemini_api_key, False),
    }

    def __init__(self) -> None:
        self._chains: dict[str, list[GoogleGenerativeAIEmbeddings]] = {}

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        """Embed stored content (courses, lessons) for indexing."""
        return self._run(_DOCUMENT_TASK, lambda e: e.embed_documents(texts))

    def embed_query(self, text: str) -> list[float]:
        """Embed a single student doubt for similarity search."""
        return self._run(_QUERY_TASK, lambda e: e.embed_query(text))

    def _run(self, task_type: str, operation):
        errors: list[Exception] = []
        for embedder in self._chain(task_type):
            try:
                return operation(embedder)
            except Exception as exc:  # noqa: BLE001 — try the next provider, then raise
                errors.append(exc)
        raise RuntimeError(f"All embedding providers failed: {errors}")

    def _chain(self, task_type: str) -> list[GoogleGenerativeAIEmbeddings]:
        if task_type not in self._chains:
            self._chains[task_type] = self._build_chain(task_type)
        return self._chains[task_type]

    def _build_chain(self, task_type: str) -> list[GoogleGenerativeAIEmbeddings]:
        if settings.llm_provider not in self._PROVIDER_SPECS:
            raise RuntimeError(
                f"LLM_PROVIDER must be '{_VERTEX}' or '{_GEMINI}', got "
                f"'{settings.llm_provider}'."
            )
        order = [settings.llm_provider] + [
            p for p in self._PROVIDER_SPECS if p != settings.llm_provider
        ]
        chain = [
            _build_embedder(key, vertexai=vertexai, task_type=task_type)
            for key, vertexai in (self._PROVIDER_SPECS[p]() for p in order)
            if key
        ]
        if not chain:
            raise RuntimeError(
                "Neither VERTEX_AI_KEY nor GEMINI_API_KEY is configured."
            )
        return chain


embedding_service = EmbeddingService()
