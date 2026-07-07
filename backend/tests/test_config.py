"""Tests for app/core/config.py — pydantic-settings Settings."""

from app.core.config import Settings, settings


def test_defaults_have_native_types():
    assert isinstance(settings.port, int)
    assert isinstance(settings.rce_rpc_timeout_seconds, float)


def test_defaults_when_env_absent(monkeypatch):
    for var in ("PORT", "RELOAD", "LOG", "LOG_LEVEL", "LLM_PROVIDER", "DATABASE_URL"):
        monkeypatch.delenv(var, raising=False)
    defaults = Settings(_env_file=None)
    assert defaults.port == 8000
    assert defaults.reload is False
    assert defaults.log_enabled is False
    assert defaults.log_level == "DEBUG"
    assert defaults.llm_provider == "vertex"
    assert defaults.psql_url.startswith("postgresql://hannibal")


def test_singleton_is_a_settings_instance():
    assert isinstance(settings, Settings)


def test_env_coercion_for_scalars(monkeypatch):
    monkeypatch.setenv("PORT", "9999")
    monkeypatch.setenv("RELOAD", "true")
    monkeypatch.setenv("RCE_RPC_TIMEOUT_SECONDS", "12.5")
    parsed = Settings()
    assert parsed.port == 9999
    assert parsed.reload is True
    assert parsed.rce_rpc_timeout_seconds == 12.5


def test_database_url_alias_maps_to_psql_url(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://alias/db")
    assert Settings().psql_url == "postgresql://alias/db"


def test_log_alias_maps_to_log_enabled(monkeypatch):
    monkeypatch.setenv("LOG", "true")
    assert Settings().log_enabled is True


def test_llm_provider_is_lowercased(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "VERTEX")
    assert Settings().llm_provider == "vertex"


def test_log_level_is_uppercased(monkeypatch):
    monkeypatch.setenv("LOG_LEVEL", "info")
    assert Settings().log_level == "INFO"


def test_settings_are_frozen():
    import pydantic

    parsed = Settings()
    try:
        parsed.port = 1
    except pydantic.ValidationError:
        return
    raise AssertionError("Settings should be frozen")


def test_unknown_env_vars_are_ignored(monkeypatch):
    monkeypatch.setenv("SOME_UNRELATED_VAR", "value")
    Settings()  # extra="ignore" — must not raise
