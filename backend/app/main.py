import uvicorn
from beanie import init_beanie
from fastapi import FastAPI
from fastapi.openapi.utils import get_openapi
from pymongo import AsyncMongoClient

from app.api.router import api_router
from app.core.config import settings
from app.core.logging import configure_logging
from app.copilotkit_routes import register_copilotkit
from app.middleware import register_middleware
from app.models import MONGO_DOCUMENT_MODELS


def _custom_openapi(app: FastAPI):
    def openapi():
        if app.openapi_schema:
            return app.openapi_schema
        schema = get_openapi(title=app.title, version=app.version, routes=app.routes)
        schema.setdefault("components", {})["securitySchemes"] = {
            "OAuth2PasswordBearer": {
                "type": "oauth2",
                "flows": {
                    "password": {
                        "tokenUrl": f"{settings.api_prefix}/auth/token",
                        "scopes": {},
                    }
                },
            }
        }
        schema["security"] = [{"OAuth2PasswordBearer": []}]
        app.openapi_schema = schema
        return schema

    return openapi


async def _lifespan(application: FastAPI):
    configure_logging()
    client = AsyncMongoClient(settings.mongo_url)
    await init_beanie(
        database=client[settings.mongo_db], document_models=MONGO_DOCUMENT_MODELS
    )
    yield
    client.close()


def create_app() -> FastAPI:
    configure_logging()

    application = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
        redirect_slashes=False,
        lifespan=_lifespan,
    )

    application.openapi = _custom_openapi(application)
    register_middleware(application)
    application.include_router(api_router, prefix=settings.api_prefix)
    register_copilotkit(application)

    return application


app = create_app()


def run() -> None:
    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.reload,
        log_level="info",
    )
