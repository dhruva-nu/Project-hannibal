import json

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from jose import JWTError, jwt

from app.agent.ai_tutor import active_ck_context, active_user_id
from app.core.config import settings


def _verify_cookie(request: Request) -> JSONResponse | None:
    token = request.cookies.get("access_token")
    if not token:
        return JSONResponse({"detail": "Not authenticated"}, status_code=401)
    try:
        jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])
    except JWTError:
        return JSONResponse({"detail": "Invalid or expired token"}, status_code=401)
    return None


def register_middleware(app: FastAPI) -> None:
    @app.middleware("http")
    async def auth_copilotkit(request: Request, call_next):
        if "/copilotkit" in request.url.path and request.method == "POST":
            if err := _verify_cookie(request):
                return err
        return await call_next(request)

    @app.middleware("http")
    async def capture_copilotkit_context(request: Request, call_next):
        if "/copilotkit" in request.url.path and request.method == "POST":
            body_bytes = await request.body()
            try:
                body_json = json.loads(body_bytes)
                if isinstance(body_json.get("context"), list):
                    active_ck_context.set(body_json["context"])
            except Exception:
                pass

            try:
                token = request.cookies.get("access_token")
                if token:
                    payload = jwt.decode(
                        token, settings.secret_key, algorithms=[settings.jwt_algorithm]
                    )
                    active_user_id.set(int(payload["sub"]))
            except Exception:
                pass

            async def receive():  # pragma: no cover
                return {"type": "http.request", "body": body_bytes, "more_body": False}

            request = Request(request.scope, receive)
        return await call_next(request)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.frontend_origin],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["*"],
    )
