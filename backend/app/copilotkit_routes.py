from fastapi import FastAPI, Request
from copilotkit.integrations.fastapi import add_fastapi_endpoint, handler as ck_handler

from app.api.v1.controllers.copilotkit_controller import sdk, info_router
from app.core.config import settings


def register_copilotkit(app: FastAPI) -> None:
    ck_prefix = f"{settings.api_prefix}/copilotkit"

    # info_router must be registered before add_fastapi_endpoint's catch-all route
    app.include_router(info_router, prefix=ck_prefix)

    # Handle no-trailing-slash requests — the JS SDK posts to /copilotkit (no slash)
    # but add_fastapi_endpoint only registers /{path:path} which requires the slash,
    # causing a 307 redirect that breaks streaming POST requests.
    async def _copilotkit_root(request: Request):
        request.path_params["path"] = ""
        return await ck_handler(request, sdk)

    app.add_api_route(
        ck_prefix, _copilotkit_root, methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"]
    )
    add_fastapi_endpoint(app, sdk, ck_prefix)
