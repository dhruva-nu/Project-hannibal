import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[3] / ".env")


@dataclass(frozen=True)
class Settings:
    app_name: str = os.getenv("APP_NAME", "Project Hannibal Backend")
    app_version: str = os.getenv("APP_VERSION", "0.1.0")
    api_prefix: str = os.getenv("API_PREFIX", "/api/v1")
    host: str = os.getenv("HOST", "0.0.0.0")  # nosec B104 — intentional server bind
    port: int = int(os.getenv("PORT", "8000"))
    reload: bool = os.getenv("RELOAD", "false").lower() == "true"
    secret_key: str = os.getenv("SECRET_KEY", "change-me-in-production")
    jwt_algorithm: str = os.getenv("JWT_ALGORITHM", "HS256")
    access_token_expire_minutes: int = int(
        os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "15")
    )
    refresh_token_expire_days: int = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "7"))
    cookie_secure: bool = os.getenv("COOKIE_SECURE", "false").lower() == "true"
    google_client_id: str = os.getenv("GOOGLE_CLIENT_ID", "")
    google_client_secret: str = os.getenv("GOOGLE_CLIENT_SECRET", "")
    google_redirect_uri: str = os.getenv(
        "GOOGLE_REDIRECT_URI",
        "http://localhost:8000/api/v1/auth/google/callback",
    )
    frontend_origin: str = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")
    vertex_ai_key: str = os.getenv("VERTEX_AI_KEY", "")
    gemini_api_key: str = os.getenv("GEMINI_API_KEY", "")
    llm_provider: str = os.getenv("LLM_PROVIDER", "vertex").lower()
    psql_url: str = os.getenv(
        "DATABASE_URL", "postgresql://hannibal:hannibal@localhost:5432/hannibal"
    )
    mongo_url: str = os.getenv(
        "MONGO_URL", "mongodb://hannibal:hannibal@localhost:27017"
    )
    mongo_db: str = os.getenv("MONGO_DB", "hannibal")
    dsl_service_url: str = os.getenv("DSL_SERVICE_URL", "http://localhost:9000")
    log_enabled: bool = os.getenv("LOG", "false").lower() == "true"
    log_file: str = os.getenv("LOG_FILE", "logs/app.log")
    log_level: str = os.getenv("LOG_LEVEL", "DEBUG").upper()


settings = Settings()
