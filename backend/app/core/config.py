from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_ENV_FILE = Path(__file__).resolve().parents[3] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore",
        frozen=True,
    )

    app_name: str = "Project Hannibal Backend"
    app_version: str = "0.1.0"
    api_prefix: str = "/api/v1"
    host: str = "0.0.0.0"  # nosec B104 — intentional server bind
    port: int = 8000
    reload: bool = False
    secret_key: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 7
    cookie_secure: bool = False
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:8000/api/v1/auth/google/callback"
    frontend_origin: str = "http://localhost:5173"
    vertex_ai_key: str = ""
    gemini_api_key: str = ""
    llm_provider: str = "vertex"
    embedding_model: str = "gemini-embedding-001"
    psql_url: str = Field(
        default="postgresql://hannibal:hannibal@localhost:5432/hannibal",
        validation_alias="DATABASE_URL",
    )
    mongo_url: str = "mongodb://hannibal:hannibal@localhost:27017"
    mongo_db: str = "hannibal"
    dsl_service_url: str = "http://localhost:9000"
    rabbitmq_url: str = "amqp://guest:guest@localhost:5672/"
    rce_rpc_timeout_seconds: float = 150
    rce_stream_idle_timeout_seconds: float = 150
    log_enabled: bool = Field(default=False, validation_alias="LOG")
    log_file: str = "logs/app.log"
    log_level: str = "DEBUG"

    @field_validator("llm_provider")
    @classmethod
    def _normalize_llm_provider(cls, value: str) -> str:
        return value.lower()

    @field_validator("log_level")
    @classmethod
    def _normalize_log_level(cls, value: str) -> str:
        return value.upper()


settings = Settings()
