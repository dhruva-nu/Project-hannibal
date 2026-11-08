# Database

Two stores. **PostgreSQL** for identity and relational structure. **MongoDB** for free-form content. The bridge is `lessons.nosql_id`, a UUID that points at a `lesson_blocks` document.

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
| `nosql_id` | UUID | **Bridge to Mongo.** Points at a `lesson_blocks` doc. |
| `type` | enum `lesson_type` {`build`, `learn`} | `build` is vestigial (DB enum untouched); seed data only has `learn`. |
| `order` | int, default 0 | Sort order within the course. |
| `info` | text, nullable | |

### `user_course_progress` — `backend/app/models/user_course_progress_model.py:10`

Composite PK (`user_id`, `course_id`). Columns: `active_lesson_id` (FK → `lessons.id`, nullable), `placed_node_ids` (`varchar(64)[]`, **vestigial** — unused by the frontend), `enrolled_at`, `updated_at`.

### `user_lesson_progress` — `backend/app/models/user_lesson_progress_model.py:9`

Composite PK (`user_id`, `lesson_id`); `completed_at` timestamptz.

### Migrations

`backend/alembic/versions/`:

1. `50478dfd04ca` — create `users`.
2. `810bdb8858ca` — add `courses`, `lessons`, `tags`.
3. `9ba532e50095` — add `order` column on `lessons`.
4. `a1b2c3d4e5f6` — add `provider`/`oauth_id` on `users`, make `hashed_password` nullable, create `refresh_tokens`.
5. `ed27b1182b5a` — add `role` column on `users`.
6. `f1a2b3c4d5e6` — add `info` to courses and lessons.
7. `7271b37d4d63` — add `user_course_progress` / `user_lesson_progress`.
8. `b3c4d5e6f7a8` — add `preference_keys` and `users.preference_id`.
9. `c5d6e7f8a9b0` — course recommendation tables (embeddings, related courses).
10. `d7e8f9a0b1c2` — add `rce_packages` (dropped again by `f2a3b4c5d6e7`).
11. `e8f9a0b1c2d3` — create `feature_flags`.
12. `f2a3b4c5d6e7` — drop `rce_packages`. Current head.

Run with `uv run alembic upgrade head` from `backend/`. Env target reads `DATABASE_URL` (`backend/alembic/env.py`).

## MongoDB

Connection: `MONGO_URL` + `MONGO_DB`. Initialized in `app/main.py` lifespan via `beanie.init_beanie`. Document models registered in `backend/app/models/__init__.py:41` (`MONGO_DOCUMENT_MODELS` = `LessonBlock`, `UserPreference`).

### `lesson_blocks` — `backend/app/models/lesson_block_model.py:6`

```python
{
  _id: UUID,        # matches lessons.nosql_id
  content: str,     # full lesson markdown / HTML
  summary: str,
}
```

### `user_preferences` — `backend/app/models/user_preference_model.py:7`

```python
{ preferences: dict[str, str], updated_at: datetime }
```

Linked from `users.preference_id`.

## Bridge summary

```
Postgres                        Mongo
─────────────────────           ──────────────────────────────
lessons.nosql_id  ──────►  lesson_blocks._id
users.preference_id ────►  user_preferences._id
```
