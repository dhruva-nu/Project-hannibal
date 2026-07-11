# Feature Flags

Server-evaluated boolean flags that gate UI. The backend owns evaluation; the frontend only ever sees a resolved `{ key: bool }` map for the current user — never the targeting rules. Two planes:

- **Evaluation plane** (`/api/v1/feature-flags`) — any authenticated user; returns which flags are on for *them*.
- **Admin plane** (`/api/v1/admin/feature-flags`) — admin-only CRUD on flag definitions.

Percentage rollout is deterministic (`sha256(key:user_id) % 100 < rollout_percentage`), so a user's bucket is sticky across sessions and raising the dial never drops anyone already inside it. No per-user assignment rows are stored.

## Database

[`feature_flags`](../01-database.md#feature_flags) — `id`, `key varchar(64) unique`, `description text`, `enabled bool`, `rollout_percentage int (0–100)`, `target_roles jsonb (nullable)`, `created_at`, `updated_at`. Created in migration `e8f9a0b1c2d3`.

Evaluation order (in the service): `enabled == false` → off (global kill switch); else `target_roles` contains the user's role → on; else percentage bucket decides.

## Backend

### Evaluation controller — `backend/app/api/v1/controllers/feature_flag_controller.py`

| Method | Path | Auth | Returns |
|---|---|---|---|
| GET | `/` | `CurrentUser` | `FeatureFlagEvaluation{flags: {key: bool}}` |

`_user_id` parses `payload["sub"]`; a malformed payload → 401.

### Admin controller — `backend/app/api/v1/controllers/admin_feature_flag_controller.py`

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/` | — | `FeatureFlagResponse[]` |
| GET | `/{key}` | — | `FeatureFlagResponse` (404 if missing) |
| POST | `/` | `FeatureFlagCreate` | `FeatureFlagResponse` (409 on duplicate key) |
| PATCH | `/{key}` | `FeatureFlagUpdate` | `FeatureFlagResponse` (404 if missing) |
| DELETE | `/{key}` | — | 204 (404 if missing) |

Every route depends on `AdminUser` (`require_admin`), which 403s non-admins.

### Service — `backend/app/services/feature_flag_service.py`

- `evaluate_for_user(user_id, role)` → `dict[str, bool]` over all flags.
- `list_flags` / `get_flag` / `create_flag` / `update_flag` / `delete_flag`.
- Module helpers `_bucket(key, user_id)` and `_is_enabled_for(flag, user_id, role)` hold the evaluation logic.
- `create_flag` raises `ValueError` on duplicate key (→ 409); the getters/mutators raise `ValueError` when a key is missing (→ 404).
- `update_flag` distinguishes "field omitted" from "explicitly set to null" via `body.model_fields_set`, so a PATCH with `target_roles: null` clears the column while a PATCH that omits it leaves it untouched.

### Repository — `backend/app/repositories/feature_flag_repository.py`

SQLAlchemy CRUD against `FeatureFlag`: `get_all`, `get_by_key`, `create`, `update` (takes an explicit `clear_target_roles` flag), `delete`.

### Schemas — `backend/app/schemas/feature_flag.py`

`FeatureFlagCreate`, `FeatureFlagUpdate` (all-optional; `rollout_percentage` bounded 0–100), `FeatureFlagResponse`, `FeatureFlagEvaluation{flags}`.

### Dependency — `backend/app/dependencies/feature_flag.py`

`get_feature_flag_service` wires `FeatureFlagRepository`; exported as `FeatureFlagServiceDep`.

## Frontend

Mirrors the `AuthContext` pattern.

- **Service** — `frontend/src/services/featureFlags.ts`: `getFeatureFlags()` → `GET /api/v1/feature-flags/`. Exports the `FeatureFlagKey` union — the compile-time source of truth for which keys code may reference (the DB stays the source of truth for state).
- **Context** — `frontend/src/context/FeatureFlagContext.tsx`: `FeatureFlagProvider` fetches once per signed-in user (refetches on user change). Fails closed — errors, in-flight, and logged-out all yield an empty map. Wired in `App.tsx` inside `AuthProvider` (it reads `useAuth`).
- **Hook** — `frontend/src/hooks/useFeatureFlag.ts`: `useFeatureFlag(key)` → `boolean`.
- **Gate** — `frontend/src/shared/components/molecules/FeatureGate/FeatureGate.tsx`: `<FeatureGate flag="..." fallback={...}>` for declarative gating.

## Known flags

| Key | Targeting | Gates |
|---|---|---|
| `admin-view-locked-lessons` | `enabled`, 0% rollout, `target_roles: ["admin"]` | Lets admins open locked lessons in the CoursePage (`unlockAll`). See [courses-and-lessons.md](./courses-and-lessons.md). |

`new-lesson-sidebar` and `copilot-v2` also exist in the frontend `FeatureFlagKey` union as examples but have no DB rows yet (so they read `false`).

## Surprises / decisions

- **Rules never reach the client.** Evaluation is server-side and returns plain booleans, so targeting strategy isn't leaked and there's a single evaluator. Client-side evaluation would only be needed for flags required *before* auth (e.g. gating the login page) — no such case exists today.
- **Fail closed everywhere.** Unknown key, loading, or fetch error all read `false`. A missing flag hides new UI, never crashes or accidentally reveals it.
- **No caching yet.** The service reads the (tiny) table per evaluation request. A short TTL cache is the natural next step and introduces the kill-switch-latency-vs-read-amplification trade-off.
- **Delete is unguarded against live references.** Deleting a flag whose key is still referenced in frontend code just makes that `useFeatureFlag` read `false` forever. Remove code references first.
