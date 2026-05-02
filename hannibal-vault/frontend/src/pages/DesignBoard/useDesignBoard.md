---
name: useDesignBoard
description: State hook for DesignBoard — manages nodes, edges, selection, pending edge drag, and all board mutations
type: file
layer: pages
tags: [hook, diagram, state, design-board]
imports:
  - "[[frontend/src/pages/DesignBoard/boardTypes]]"
---

# `pages/DesignBoard/useDesignBoard.ts`

**Used by:** [[frontend/src/pages/DesignBoard/DesignBoard]]

---

Central state store for the design board. Owns all mutable state:

| State | Type | Purpose |
|---|---|---|
| `nodes` | `Record<string, BoardNodeData>` | All component and service nodes keyed by id |
| `edges` | `BoardEdge[]` | All drawn connections |
| `selected` | `SelectedItem \| null` | Currently selected node / module / edge |
| `pending` | `PendingEdge \| null` | In-progress edge drag (cleared on pointerup) |

Also exposes `innerRef` (`RefObject<HTMLDivElement>`) — attached to the canvas inner div by [[frontend/src/shared/components/organisms/DesignCanvas]] and used for DOM-coordinate calculations.

---

## `startEdge` — pointer-starts edge from port

Sets `pending` state with the origin port and initial cursor position (translated to canvas-inner coordinates via `innerRef`).

## `finishEdge` — completes edge at target port

Reads `pendingRef.current` (a ref that mirrors `pending` state, so global event handlers always see the latest value without stale closures). If origin ≠ target, pushes a new `BoardEdge` to `edges`.

## Global pointer tracking — `useEffect([isPending])`

When `isPending` becomes `true`, attaches `pointermove` / `pointerup` to `window`:
- `pointermove`: updates `pending.x / .y` so [[frontend/src/shared/components/organisms/DesignCanvas]] can draw the in-progress line.
- `pointerup`: clears `pending` if the user released without hitting a port. The effect cleanup removes the listeners when `isPending` returns to `false`.

## `handleDrop` — palette item dropped onto canvas

Determines drop type: `"service"` creates a new service node; `"module"` calls `findServiceAt(x, y)` to test if the drop landed inside an existing service (DOM-based hit test via `innerRef`) and either adds to it or creates a free component; anything else creates a component node.

## `seed` — initial demo state

Populates a "Client → BE service (Auth + Gateway) → DB, Redis; BE → OAuth" topology for first load.

## Mutations summary

| Function | What it changes |
|---|---|
| `moveNode(id, x, y)` | Updates `nodes[id].x / .y` |
| `updateLabel(nodeId, label, moduleId?)` | Renames node or one of its modules |
| `addModule(serviceId, label)` | Pushes new module (max 5) |
| `deleteNode(nodeId)` | Removes node + all its edges |
| `deleteModule(nodeId, moduleId)` | Removes module + edges touching it |
| `deleteEdge(edgeId)` | Removes one edge |
| `clearBoard()` | Resets all state |
| `exportJson()` | Downloads `{ nodes, edges }` as JSON via blob URL |
