# Database

Two stores. **PostgreSQL** for identity and relational structure. **MongoDB** for free-form content. The bridge is `lessons.nosql_id`, a UUID that points at either a `lesson_blocks` or `build_blocks` document depending on `lessons.type`.

## PostgreSQL

Connection: `DATABASE_URL` env var. Models in `backend/app/models/*.py`. Migrations in `backend/alembic/versions/`.

### `users` — `backend/app/models/user.py:14`

| Column | Type | Notes |
|---|---|---|
| `id` | int PK | |
| `email` | str, unique, indexed | Login identity. |
| `role` | enum `users_level` {`admin`, `student`} | **Default in model:** `admin`. The user repository overrides to `student` on create. Audit existing rows. |
| `hashed_password` | str, nullable | `NULL` for OAuth-only users. |
| `provider` | str, default `"local"` | `"local"`, `"google"`, etc. |
| `oauth_id` | str, nullable | Provider's stable user id. |
| `created_at` | timestamptz | |

OAuth-collision rule: if a Google sign-in arrives with an email that already exists as a local user, the existing row is patched with `provider="google"` + `oauth_id`. The user can then log in either way. See `UserRepository.get_or_create_oauth_user` at `backend/app/repositories/user_repository.py:23-38`.

### `refresh_tokens` — `backend/app/models/refresh_token.py:8`

| Column | Type | Notes |
|---|---|---|
| `id` | int PK | |
| `user_id` | int FK → `users.id` | |
| `jti` | str, unique, indexed | JWT ID; what the refresh token JWT claims. |
| `expires_at` | timestamptz | Mirrors the JWT `exp`. |
| `revoked` | bool, default false | Set true on logout. |
| `created_at` | timestamptz | |

Refresh tokens are **not rotated** on `/auth/refresh` — the same `jti` lives until logout or expiry. Trade-off: simpler revocation, weaker than rotation against replay. See `AuthService.refresh` (`backend/app/services/auth_service.py:44-64`).

### `tags` — `backend/app/models/tags_model.py:7`

| Column | Type |
|---|---|
| `id` | int PK |
| `name` | varchar(20) |
| `description` | text |

A course optionally points at one tag.

### `feature_flags` — `backend/app/models/feature_flag_model.py:11`

| Column | Type |
|---|---|
| `id` | int PK |
| `key` | varchar(64), unique |
| `description` | text |
| `enabled` | bool — global kill switch |
| `rollout_percentage` | int 0–100 |
| `target_roles` | jsonb, nullable — role allowlist |
| `created_at` / `updated_at` | timestamptz |

Server-evaluated flags. No per-user assignment table: percentage rollout is deterministic from `sha256(key:user_id)`. See [features/feature-flags.md](./features/feature-flags.md).

### `courses` — `backend/app/models/course_model.py:16`

| Column | Type | Notes |
|---|---|---|
| `id` | int PK | |
| `name` | varchar(50) | |
| `category` | `varchar(20)[]` | Postgres array; multi-select in the FE filter bar. |
| `tag_id` | int FK → `tags.id`, nullable | |
| `enrol_num` | int, default 0 | |
| `cover_img` | str | URL. |
| `level` | enum `course_level` {`beginner`, `intermediate`, `expert`} | |
| `description` | text | |
| `lesson_count` | int, default 0 | Denormalized; bumped on lesson create. |

### `lessons` — `backend/app/models/lesson_model.py:15`

| Column | Type | Notes |
|---|---|---|
| `id` | int PK | |
| `course_id` | int FK → `courses.id` | |
| `name` | varchar(50) | |
| `learning` | text | One-line learning objective. |
| `nosql_id` | UUID | **Bridge to Mongo.** Points at a `lesson_blocks` or `build_blocks` doc, picked by `type`. |
| `type` | enum `lesson_type` {`build`, `learn`} | |
| `order` | int, default 0 | Sort order within the course. |

### Migrations

`backend/alembic/versions/`:

1. `50478dfd04ca` — create `users`.
2. `810bdb8858ca` — add `courses`, `lessons`, `tags`.
3. `9ba532e50095` — add `order` column on `lessons`.
4. `a1b2c3d4e5f6` — add `provider`/`oauth_id` on `users`, make `hashed_password` nullable, create `refresh_tokens`.
5. `ed27b1182b5a` — add `role` column on `users`.
6. `e8f9a0b1c2d3` — create `feature_flags`.

Run with `uv run alembic upgrade head` from `backend/`. Env target reads `DATABASE_URL` (`backend/alembic/env.py`).

## MongoDB

Connection: `MONGO_URL` + `MONGO_DB`. Initialized in `app/main.py` lifespan via `beanie.init_beanie`. Document models registered in `backend/app/models/__init__.py:25` (`MONGO_DOCUMENT_MODELS`).

### `lesson_blocks` — `backend/app/models/lesson_block_model.py:6`

```python
{
  _id: UUID,        # matches lessons.nosql_id for type="learn"
  content: str,     # full lesson markdown / HTML
  summary: str,
}
```

### `build_blocks` — `backend/app/models/build_block_model.py:13`

```python
{
  _id: str (UUID),  # matches lessons.nosql_id for type="build"
  instructions: str,
  input: str,
  output: str,
  test_code: str,      # contains literal "--user-code--" placeholder
  code_template: str,
  type: str,           # the build-block kind, used by DSL service
  tests: [{name, description}, …],
  obj_id: str | null,  # → nodes._id (root of the placement graph for this lesson)
}
```

The `--user-code--` marker is required. `add_test_code()` (`backend/app/services/rce/runners/simple.py:17-27`) splices the student's code into the test harness at this token before sending to Docker. Missing the placeholder raises `TestCodeSyntaxFailure`.

### `nodes` — `backend/app/models/node_model.py:11`

```python
{
  _id: str (UUID),
  type: "component" | "service" | "module",
  label: str,
  parent_id: str | null,        # null for roots / top-level components
  linked_node_ids: [str],       # outbound edges in the graph
  default_x: float | null,
  default_y: float | null,
  default_w: float | null,
}
```

Nodes form a graph. `parent_id` gives nesting (a `module` lives inside a `service`); `linked_node_ids` gives directed edges. When a student finishes a build lesson and clicks "place on board", the FE calls `GET /api/v1/nodes/{obj_id}/placement` — the BE does a BFS from that root and returns the connected subgraph for the FE to render.

## Bridge summary

```
Postgres                        Mongo
─────────────────────           ──────────────────────────────
lessons.nosql_id  ──────►  lesson_blocks._id   (if type="learn")
lessons.nosql_id  ──────►  build_blocks._id    (if type="build")
                            build_blocks.obj_id  ──►  nodes._id  (placement root)
```
