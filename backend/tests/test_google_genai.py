"""Unit tests for the shared ``google_api_key`` context manager.

It pins ``GOOGLE_API_KEY`` for the duration of a google-genai client build and
restores the prior environment afterwards. Both the tutor LLM clients and the
embedding service depend on this exact behaviour.
"""

import os

import pytest

from app.core.google_genai import google_api_key


class TestGoogleApiKeyContext:
    def test_sets_key_inside_block(self):
        os.environ.pop("GOOGLE_API_KEY", None)
        with google_api_key("temp"):
            assert os.environ["GOOGLE_API_KEY"] == "temp"

    def test_restores_previous_value(self):
        os.environ["GOOGLE_API_KEY"] = "original"
        with google_api_key("temp"):
            assert os.environ["GOOGLE_API_KEY"] == "temp"
        assert os.environ["GOOGLE_API_KEY"] == "original"

    def test_pops_key_when_absent_before(self):
        os.environ.pop("GOOGLE_API_KEY", None)
        with google_api_key("temp"):
            assert os.environ["GOOGLE_API_KEY"] == "temp"
        assert "GOOGLE_API_KEY" not in os.environ

    def test_restores_previous_value_on_exception(self):
        os.environ["GOOGLE_API_KEY"] = "original"
        with pytest.raises(ValueError):
            with google_api_key("temp"):
                raise ValueError("boom")
        assert os.environ["GOOGLE_API_KEY"] == "original"

    def test_pops_key_on_exception_when_absent_before(self):
        os.environ.pop("GOOGLE_API_KEY", None)
        with pytest.raises(ValueError):
            with google_api_key("temp"):
                raise ValueError("boom")
        assert "GOOGLE_API_KEY" not in os.environ
