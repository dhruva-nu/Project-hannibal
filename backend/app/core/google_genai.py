import os
from contextlib import contextmanager


@contextmanager
def google_api_key(key: str):
    """Pin ``GOOGLE_API_KEY`` while a google-genai client is built.

    Vertex express mode resolves its key from ``GOOGLE_API_KEY``, which
    google-genai prefers over ``GEMINI_API_KEY``. Without this the Gemini
    developer key in the env leaks into the Vertex client and it 401s. The
    key is read and cached at construction, so the env is restored afterwards.
    """
    previous = os.environ.get("GOOGLE_API_KEY")
    os.environ["GOOGLE_API_KEY"] = key
    try:
        yield
    finally:
        if previous is None:
            os.environ.pop("GOOGLE_API_KEY", None)
        else:
            os.environ["GOOGLE_API_KEY"] = previous
