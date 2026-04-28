---
name: config.py
description: Settings dataclass — reads all env vars from .env at import time, exposes a frozen singleton
type: file
layer: infra
tags: [config, settings, env]
---

# `app/core/config.py`

Defines the `Settings` frozen dataclass. Loaded once at import time via `load_dotenv`. All other modules import the `settings` singleton directly.

**Used by:** [[app/main]] · [[app/api/v1/controllers/auth_controller]] · [[app/services/auth_service]] · [[app/api/v1/controllers/copilotkit_controller]]

---

## `settings` singleton — line 33

The single `Settings()` instance. Fields and their env var names:

| Field | Env Var | Default |
|---|---|---|
| `app_name` | `APP_NAME` | `"Project Hannibal Backend"` |
| `api_prefix` | `API_PREFIX` | `"/api/v1"` |
| `secret_key` | `SECRET_KEY` | `"change-me-in-production"` |
| `jwt_algorithm` | `JWT_ALGORITHM` | `"HS256"` |
| `access_token_expire_minutes` | `ACCESS_TOKEN_EXPIRE_MINUTES` | `15` |
| `refresh_token_expire_days` | `REFRESH_TOKEN_EXPIRE_DAYS` | `7` |
| `cookie_secure` | `COOKIE_SECURE` | `false` |
| `google_client_id` | `GOOGLE_CLIENT_ID` | `""` |
| `google_client_secret` | `GOOGLE_CLIENT_SECRET` | `""` |
| `google_redirect_uri` | `GOOGLE_REDIRECT_URI` | `localhost:8000/...callback` |
| `frontend_origin` | `FRONTEND_ORIGIN` | `"http://localhost:5173"` |
| `gemini_api_key` | `GEMINI_API_KEY` | `""` |
