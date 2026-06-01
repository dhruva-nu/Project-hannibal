# NodeRepository

**File:** `backend/app/repositories/node_repository.py`
**Model:** `backend/app/models/node_model.py` — `Node(id, type: "component"|"service"|"module", label, parent_id?, default_x?, default_y?, default_w?)` (Beanie Document, collection `nodes`)

`parent_id` is set on `module`-type Nodes and references a service-type Node's id (flat parent_id model rather than embedded modules).

## Methods

| Method | Lines | Query |
|--------|-------|-------|
| `get_by_id` | 5–6 | `find_one({"_id": node_id})` |
| `get_children` | 8–9 | `find({"parent_id": parent_id})` |

## Called by

← [[NodeService]]
