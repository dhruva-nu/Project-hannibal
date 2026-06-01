# NodeService

**File:** `backend/app/services/node_service.py`
**Class:** `NodeService`

## Methods

| Method | Lines | Notes |
|--------|-------|-------|
| `get_placement` | 8–22 | Fetches the node by id. If `type == "module"` and `parent_id` is set, also fetches and returns the parent service. Raises `ValueError` if the requested node is not found (controller maps to 404). |

## Calls

→ [[NodeRepository]]
