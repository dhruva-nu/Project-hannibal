# TagsRepository

**File:** `backend/app/repositories/tags_repository.py`  
**Model:** `backend/app/models/tags_model.py` — `Tags(id, name, description)`

## Methods

| Method | Lines | Query |
|--------|-------|-------|
| `get_all` | 10–11 | `SELECT * FROM tags` |
| `get_by_id` | 13–14 | `WHERE id = ?` |
| `create` | 16–20 | INSERT tag |
| `update` | 22–28 | name / description update + commit |
| `delete` | 30–32 | DELETE + commit |

## Called by

← [[TagsService]]
