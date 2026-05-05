# TagsService

**File:** `backend/app/services/tags_service.py`  
**Class:** `TagsService`

## Methods

| Method | Lines | Notes |
|--------|-------|-------|
| `list_tags` | 10–11 | All tags |
| `get_tag` | 13–17 | Raises `ValueError` if not found |
| `create_tag` | 19–21 | Name + description |
| `update_tag` | 23–28 | Checks existence, partial update |
| `delete_tag` | 30–34 | Checks existence, delete |

## Calls

→ [[TagsRepository]]
