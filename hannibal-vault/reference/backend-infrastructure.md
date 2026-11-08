# Backend Infrastructure

Everything the FastAPI app needs that isn't a feature. App bootstrap, middleware, config, database wiring, dependency injection, exceptions, migrations, testing, deployment.

## App entry — `backend/app/main.py`

`create_app()` builds the FastAPI instance:

1. Loads `Settings` from env (`core/config.py`).
2. Configures logging (`core/logging.py`).
3. Registers an async `_lifespan` context manager that:
   - Opens an `AsyncMongoClient` to `MONGO_URL`.
   - Calls `init_beanie(database=..., document_models=MONGO_DOCUMENT_MODELS)` — registers `LessonBlock`, `UserPreference` (`models/__init__.py:41-44`).
4. Adds the middleware stack (see below).
5. Mounts `api_router` under `API_PREFIX` (`/api/v1`).
6. Mounts the CopilotKit endpoint at `/api/v1/copilotkit` via `copilotkit_routes.add_fastapi_endpoint`.
7. Customizes OpenAPI to declare the JWT cookie scheme for the Swagger UI.

`run()` (`main.py:72`) launches `uvicorn.run("app.main:app", host=settings.host, port=settings.port, reload=settings.reload)`.

## Middleware — `backend/app/middleware.py`

Stack order (outermost first):

1. **CORS** (`fastapi.middleware.cors.CORSMiddleware`) — allows `settings.frontend_origin`, all methods/headers, `allow_credentials=True`. Exposes all headers.
2. **`capture_copilotkit_context`** — for requests to `/api/v1/copilotkit/*`, reads the body once, extracts the `context` block, and stashes it in a `contextvars.ContextVar` so the agent can read it later. Body is re-buffered so downstream handlers can still read it.
3. **`auth_copilotkit`** — for `POST /api/v1/copilotkit/*`, reads the `access_token` cookie and verifies it via `AuthService.verify_token`. 401 on missing/invalid. The regular `require_auth` dependency doesn't run on these routes because the CopilotKit SDK owns the route handler.

## Configuration — `backend/app/core/config.py`

`Settings` is a frozen `pydantic_settings.BaseSettings` subclass. Fields are declared with native types (`int`, `bool`, `float`, `str`) and pydantic handles env parsing/coercion and validation. `.env` (repo root) is loaded via `SettingsConfigDict(env_file=..., extra="ignore")`; unknown env vars are ignored. Env matching is case-insensitive, so `app_name` ← `APP_NAME`. Fields whose env name differs use `validation_alias`: `psql_url` ← `DATABASE_URL`, `log_enabled` ← `LOG`. Field validators normalize `llm_provider` (lowercased) and `log_level` (uppercased). The `settings = Settings()` singleton is the only supported access point (do not read class attributes).

**Credential-bearing settings have no defaults and are required** — `SECRET_KEY`, `DATABASE_URL`, `MONGO_URL`. A missing value raises a `ValidationError` at startup rather than silently falling back to a baked-in credential.

| Setting | Env var | Default |
|---|---|---|
| App identity | `APP_NAME` | `Project Hannibal Backend` |
| | `APP_VERSION` | `0.1.0` |
| Routing | `API_PREFIX` | `/api/v1` |
| Server | `HOST` | `0.0.0.0` |
| | `PORT` | `8000` |
| | `RELOAD` | `False` |
| JWT | `SECRET_KEY` | — (**required**) |
| | `JWT_ALGORITHM` | `HS256` |
| | `ACCESS_TOKEN_EXPIRE_MINUTES` | `15` |
| | `REFRESH_TOKEN_EXPIRE_DAYS` | `7` |
| Cookies | `COOKIE_SECURE` | `False` |
| OAuth | `GOOGLE_CLIENT_ID` | — |
| | `GOOGLE_CLIENT_SECRET` | — |
| | `GOOGLE_REDIRECT_URI` | `http://localhost:8000/api/v1/auth/google/callback` |
| Cross-origin | `FRONTEND_ORIGIN` | `http://localhost:5173` |
| AI | `GEMINI_API_KEY` | — |
| Databases | `DATABASE_URL` | — (**required**; Postgres SQLAlchemy URL) |
| | `MONGO_URL` | — (**required**) |
| | `MONGO_DB` | `hannibal` |
| LLM | `LLM_PROVIDER` | `vertex` |
| | `VERTEX_AI_KEY` | — |
| | `EMBEDDING_MODEL` | `gemini-embedding-001` |
| Logging | `LOG` (→ `log_enabled`), `LOG_FILE`, `LOG_LEVEL` | sensible defaults |

## Logging — `backend/app/core/logging.py`

Standard `logging.basicConfig` with `[%(asctime)s] %(levelname)s %(name)s — %(message)s`. If `LOG_ENABLED=true`, also attaches a `RotatingFileHandler` (10 MB per file, 5 backups) at `LOG_FILE`. Level from `LOG_LEVEL` (default `INFO`).

## Database wiring

### Postgres — `backend/app/db/`

| File | Role |
|---|---|
| `base.py` | `class Base(DeclarativeBase): ...` — every ORM model inherits this. |
| `session.py` | `engine = create_engine(DATABASE_URL)`; `SessionLocal = sessionmaker(engine, autoflush=False, autocommit=False)`. **Sync**, not async. |

`get_db` (`dependencies/db.py`) yields a `SessionLocal()` per request and closes it in `finally`.

### Mongo — initialized in `main.py` lifespan

```python
client = AsyncMongoClient(settings.mongo_url)
await init_beanie(
    database=client[settings.mongo_db],
    document_models=MONGO_DOCUMENT_MODELS,
)
```

No global session — Beanie's document methods (`LessonBlock.find_one`, etc.) talk to the registered client directly.

## Router aggregation — `backend/app/api/router.py`

A single `APIRouter()` that includes one router per feature:

```
health               → /health
auth                 → /auth
tags                 → /tags
feature-flags        → /feature-flags
admin/feature-flags  → /admin/feature-flags
courses              → /courses
lessons              → /lessons
lesson-blocks        → /lesson-blocks
progress             → /progress
user-preferences     → /user-preferences
```

`main.py` mounts the aggregate under `API_PREFIX`. The `v1` directory exists but the version segment is in the prefix, not in each sub-router's path.

## Dependency injection

Every controller takes its service via `Depends(...)`. Services are constructed per request with a fresh DB session. This is what `dependencies/` does — one factory per service:

| File | Provides |
|---|---|
| `dependencies/db.py` | `get_db()` — yields a Postgres `Session`. |
| `dependencies/auth.py` | `get_auth_service`, `require_auth`, `require_admin`. |
| `dependencies/access.py` | `require_admin`, `require_quota` (the quota check is a TODO, currently no-op). |
| `dependencies/course.py` | `get_course_service`, `get_lesson_service`, `get_lesson_block_service`. |
| `dependencies/lesson_block.py` | `get_lesson_block_service` (Mongo). |
| `dependencies/progress.py` | `get_progress_service`. |
| `dependencies/feature_flag.py` | `get_feature_flag_service`. |
| `dependencies/user_preference.py` | `get_user_preference_service`. |
| `dependencies/tags.py` | `get_tags_service`. |
| `dependencies/health.py` | `get_health_service`. |

Tests override these via `app.dependency_overrides` (see Testing below). The real DB is never hit in tests.

## Errors

There is no `exception/` package. Services raise plain `ValueError` for "not found" and controllers translate them to HTTP responses (404).

## Repository pattern — `backend/app/repositories/base.py`

```python
class Repository(Protocol[T]):
    def get(self) -> T: ...
```

A nominal Protocol — repositories don't actually need to inherit anything; they conform structurally. Concrete repos define the methods their service needs (`get_all`, `get_by_id`, `create`, `update`, `delete`, plus feature-specific lookups).

## Migrations (Alembic)

| File | Role |
|---|---|
| `backend/alembic.ini` | Standard config. `script_location = ./alembic`. |
| `backend/alembic/env.py` | Reads `DATABASE_URL` from env to override `sqlalchemy.url`. Imports `Base` + all models so autogenerate sees them. |
| `backend/alembic/versions/` | Migrations listed in [`01-database.md`](../01-database.md#migrations). |

Run: `uv run alembic upgrade head` from `backend/`.

## Tests — `backend/tests/`

Stack: `pytest`, `pytest-asyncio`, `pytest-mock`, FastAPI `TestClient`.

Layout:

```
backend/tests/
├── test_<file>.py            unit tests per controller/service/repo
└── integration/
    ├── conftest.py            shared fixtures
    └── test_<feature>.py
```

`integration/conftest.py` defines:

- `mock_db` — a `Session`-shaped `MagicMock` substituted into `get_db` via `app.dependency_overrides`.
- `client` — `TestClient(app)`.
- `admin_token` / `user_token` — pre-signed JWTs (HS256, `SECRET_KEY`) for cookie injection.

The real database is never opened during tests.

## Docker & Compose — `docker-compose.yml`

| Service | Image / build | Port | Notes |
|---|---|---|---|
| `db` | `pgvector/pgvector:0.8.4-pg17` | 5432 | Volume `db_data`; healthcheck `pg_isready`. |
| `mongo` | `mongo:8` | 27017 | Volume `mongo_data`; init creds from `.env`. |
| `backend` | build `./backend/Dockerfile` (Python 3.14, `uv sync --frozen --no-dev`) | 8000 | Depends on `db` (healthy). |
| `frontend` | build `./frontend/Dockerfile` | 5173 → 80 | `VITE_COPILOTKIT_RUNTIME_URL` baked in at build. |

## Runtime dependencies (key ones from `pyproject.toml`)

- `fastapi`, `uvicorn`
- `sqlalchemy`, `psycopg2-binary`, `alembic`
- `beanie`, (Motor / pymongo via Beanie)
- `pydantic[email]`
- `python-jose` (JWT), `bcrypt`
- `httpx` (OAuth)
- `copilotkit`, `langgraph`, `langchain-google-genai` (CopilotKit + Gemini)
- `pgvector` (embeddings)
- `python-dotenv`

Dev: `pytest`, `pytest-asyncio`, `pytest-cov`, `pytest-mock`, `black`, `ruff`, `bandit`.
