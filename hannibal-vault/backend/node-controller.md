# node-controller

**File:** `backend/app/api/v1/controllers/node_controller.py`
**Router prefix:** `/api/v1/nodes`

## Endpoints

| Method | Path | Function | Lines | Auth |
|--------|------|----------|-------|------|
| `GET` | `/{node_id}/placement` | `get_node_placement` | 14–31 | ❌ |

Returns the requested Node plus its parent service (when the node is a `module`). Used by the frontend "place on board" flow after a build_block's tests pass — frontend resolves `build_block.obj_id → node._id` then hits this endpoint to fetch render data.

## Calls

→ [[NodeService]]
