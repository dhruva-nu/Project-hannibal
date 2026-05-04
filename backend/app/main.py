import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from copilotkit.integrations.fastapi import add_fastapi_endpoint, handler as ck_handler
from jose import JWTError, jwt
import uvicorn

from app.api.router import api_router
from app.api.v1.controllers.copilotkit_controller import sdk, info_router, active_ck_context
from app.core.config import settings
from app.core.logging import configure_logging
from app.db.mongo import close_mongo_client


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await close_mongo_client()


def create_app() -> FastAPI:
    configure_logging()

    application = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
        redirect_slashes=False,
        lifespan=lifespan,
    )

    @application.middleware("http")
    async def auth_copilotkit(request: Request, call_next):
        """Require a valid access_token cookie on all non-preflight CopilotKit requests."""
        if "/copilotkit" in request.url.path and request.method == "POST":
            token = request.cookies.get("access_token")
            if not token:
                return JSONResponse({"detail": "Not authenticated"}, status_code=401)
            try:
                jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])
            except JWTError:
                return JSONResponse({"detail": "Invalid or expired token"}, status_code=401)
        return await call_next(request)

    @application.middleware("http")
    async def capture_copilotkit_context(request: Request, call_next):
        if "/copilotkit" in request.url.path and request.method == "POST":
            import json as _json
            body_bytes = await request.body()
            try:
                body_json = _json.loads(body_bytes)
                if isinstance(body_json.get("context"), list):
                    active_ck_context.set(body_json["context"])
            except Exception:
                pass
            async def receive():  # pragma: no cover
                return {"type": "http.request", "body": body_bytes, "more_body": False}
            request = Request(request.scope, receive)
        return await call_next(request)

    application.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.frontend_origin],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["*"],
    )

    application.include_router(api_router, prefix=settings.api_prefix)
    # info_router must be registered before add_fastapi_endpoint's catch-all route
    application.include_router(info_router, prefix=f"{settings.api_prefix}/copilotkit")

    # Handle no-trailing-slash requests — the JS SDK posts to /copilotkit (no slash)
    # but add_fastapi_endpoint only registers /{path:path} which requires the slash,
    # causing a 307 redirect that breaks streaming POST requests.
    ck_prefix = f"{settings.api_prefix}/copilotkit"

    async def _copilotkit_root(request: Request):
        request.path_params["path"] = ""
        return await ck_handler(request, sdk)

    application.add_api_route(ck_prefix, _copilotkit_root, methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"])
    add_fastapi_endpoint(application, sdk, ck_prefix)
    return application


app = create_app()


def run() -> None:
    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.reload,
    )
