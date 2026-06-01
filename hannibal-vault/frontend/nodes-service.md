# nodes-service

**File:** `frontend/src/services/nodes.ts`

Thin HTTP wrapper around `/api/v1/nodes/*`. Maps snake_case backend payloads to camelCase `NodeRecord` for the UI.

## Functions

| Function | Lines | Returns |
|----------|-------|---------|
| `getNodePlacement(nodeId)` | 47–52 | `NodePlacement = { node, parent }` — used when the user clicks "place on board" in BuildPanel and the active lesson's `build_block.obj_id` resolves to a Node id |

## Called by

← [[useCourseState]] (`placeOnBoard`)

## Calls

→ [[node-controller]] (`GET /api/v1/nodes/{id}/placement`)
