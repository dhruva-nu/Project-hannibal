# Tags

Plain CRUD for the `tags` table. A course optionally points at one tag via `courses.tag_id`. There is **no FE service or page for tags today** — they're managed via the API directly (or admin tooling not yet built).

## Database

[`tags`](../01-database.md#tags) — `id`, `name varchar(20)`, `description text`. Created in migration `810bdb8858ca`.

## Backend

All routes under `/api/v1/tags`.

### Controller — `backend/app/api/v1/controllers/tags_controller.py:13-99`

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/` | — | `TagResponse[]` |
| GET | `/{tag_id}` | — | `TagResponse` |
| POST | `/` | `TagCreate{name, description}` | `TagResponse` |
| PATCH | `/{tag_id}` | `TagUpdate{name?, description?}` | `TagResponse` |
| DELETE | `/{tag_id}` | — | 204 |

### Service — `backend/app/services/tags_service.py:5-36`

Methods mirror the controller routes one-to-one: `list_tags`, `get_tag`, `create_tag`, `update_tag`, `delete_tag`. Each raises `ValueError` when a referenced tag id doesn't exist; the controller translates that into 404.

### Repository — `backend/app/repositories/tags_repository.py:6-35`

Standard SQLAlchemy CRUD against `Tags`: `get_all`, `get_by_id`, `create`, `update`, `delete`.

### Schemas — `backend/app/schemas/tags.py:4-19`

```python
class TagCreate(BaseModel):  name: str; description: str
class TagUpdate(BaseModel):  name: str | None; description: str | None
class TagResponse(BaseModel): id: int; name: str; description: str
```

### Dependency — `backend/app/dependencies/tags.py:9-10`

```python
def get_tags_service(db = Depends(get_db)) -> TagsService:
    return TagsService(TagsRepository(db))
```

## Frontend

No `services/tags.ts`, no page. If a future "browse by tag" feature is added, the natural shape is:

```ts
// frontend/src/services/tags.ts (does not exist yet)
listTags()  →  GET /api/v1/tags/
```

Today, `Course.tagId` exists on the FE type but isn't read by any component.

## Surprises

- **No referential cleanup on delete.** Deleting a tag does not null out `courses.tag_id` on any course that points at it. Postgres will accept it because the FK is nullable — but the course row keeps the now-dangling id. Add `ON DELETE SET NULL` if this matters.
- **Admin auth is not enforced.** All five routes are open (no `require_admin` dependency). Either add it before exposing the API publicly, or front it with an admin-only gateway.
