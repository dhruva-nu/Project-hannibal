# Architecture Designer (`/arch-test`)

A visual tool for designing a whole application architecture and tracing a request through it: **Client → Backend → Database** layers, infrastructure (caches, load balancers, gateways, Docker/Kubernetes containers), and a step-by-step request tracer. It is a port of the standalone `files/architecture-designer.html` prototype into the Hannibal design system. Frontend only — **no backend calls**; the diagram persists in `localStorage` under `arch-designer-v1`.

Route: `/arch-test` (protected, `App.tsx`, listed in `routes.ts`). Page: `frontend/src/pages/ArchTest/ArchTest.tsx:20`.

## What you can do

- **Overview canvas** — three layer cards; arrows are *derived* from the real connections (`visibility.ts:108`). Click a card to open that layer: the card grows in place into a large window (`WINDOW_INSET` in `view/dock.ts`) while every other card and the Event bus shrink into chips docked on the top/bottom edge, keeping their left-to-right order, and the connectors re-route to the new boxes (`dockModel`, `useDockMotion`, `useWindowGrow`). Click a chip to switch layers (`useScopeView.ts` `openScope`).
- **Layer window** — components of that layer; connections to other layers appear as ghost cards. Drag to pan, Ctrl/Cmd+scroll to zoom, double-click a box for details.
- **Containers** — Docker / Kubernetes boxes are resizable; boxes dropped inside get `parent` and move with the container (`engine/model.ts` `reparent`).
- **Request tracing** — select a Component → *Trace request*. Steps cover component → function → API → connector → DB query → response, with payloads, cold/warm cache (HIT/MISS), schema-mismatch warnings and state updates. The canvas follows the active step across layers.
- **Data flow mode** — payload chips on every connection, field mappings, mismatch warnings (`Data flow` toolbar toggle). **State links** draws which components read/modify state variables (client layer).
- **Undo/redo** (60 steps, typing coalesced 1.5 s), **Group**, **Insert infrastructure** into a connection, **File ▸ example / blank / export-import JSON**.

## Layout of the code

```
frontend/src/pages/ArchTest/
├── ArchTest.tsx                 page shell: toolbar, menus, keyboard (Esc, Ctrl+Z/Y, Delete), providers
├── engine/                      PURE logic, no React/DOM (port of the prototype's engines)
│   ├── types.ts / registry.ts   node/edge types; REG component registry (add an infra type = one infra(...) line)
│   ├── model.ts                 lookups, normalize(), reparent(), reach(), connector/db helpers
│   ├── query.ts                 runQuery / buildQuery / shapeConnector over sample rows (SQL + Mongo)
│   ├── payload.ts               applyEdge field mapping, diffPayload, shapeDiff (mismatch warnings)
│   ├── trace.ts                 runTrace:393 — request/response engine (one helper per behaviour)
│   ├── simulate.ts              silent simulation feeding data-flow + warnings; edgeInfo:62
│   ├── starter.ts               the "user profile" example + blank diagram + sample-row helpers
│   ├── persistence.ts / history.ts   localStorage save/load, undo stack with coalescing
├── state/
│   ├── archApi.ts               ArchApi contract + ArchContext/useArch() used by panels and modals
│   ├── useArchController.ts:49  composes everything into the ArchApi; owns selection/modal/notice
│   ├── useModelStore.ts:53      immutable commits (clone → mutate → normalize), undo/redo, debounced persist
│   ├── useScopeView.ts:45       overview/layer scope, per-scope pan/zoom/fit
│   ├── useTraceState.ts:47      trace request state; cold run then warm run computed purely
│   ├── useGraphActions.ts:55    add/connect/insert/delete/group; structure.ts holds the pure model edits
├── view/                        pure geometry: geometry.ts, dock.ts (window box, chip docking, grow origin), visibility.ts (ghosts, derived edges), edgeScene.ts, overrides.ts
├── components/
│   ├── canvas/                  Canvas.tsx:28 + World/NodeCard/ContainerBox/EdgeLayer/EdgeChips; gestures/ (drag, resize, connect, pan, marquee)
│   ├── panel/                   right inspector: Panel.tsx → one panel per node type, edge, group (a selected BE service opens servicePopup instead)
│   ├── servicePopup/            BE service popup: Controller tab (endpoint contract) + Service layer tab (ordered call chain: DB query or in-app service; per-service library of in-app services, step kinds in engine/appServices.ts)
│   ├── overlays/                TraceDrawer, ModalHost (confirm, io, detail views, flow table, connect picker)
│   ├── menus/                   Add / Insert / File menus
│   └── TopBar.tsx, Toast.tsx
└── ui/                          Controls.tsx (compact form primitives), NodeLinks.tsx
```

## Key rules

- Every node has `layer` (`client` | `backend` | `db` | `null` for infrastructure shown on the overview) and an optional `parent` (container id). Layer cards are `model.lnodes`, separate from `model.nodes`.
- Only **real** edges are stored. Overview edges are derived (`id: "ov|a|b"`, `derived: true`, `ids: [...real edge ids]`).
- Edges carry `map` rows (rename a field or set a constant); `applyEdge` applies them and drives mismatch detection through `expectedFor`.
- **State is immutable at the React boundary:** `commit(mutator)` clones the model, runs the mutator, `normalize`s, publishes. Engine functions mutate the draft they are given. Drags use transient `GeometryOverrides` (`view/overrides.ts`) and commit once on release, so one drag = one undo step.
- The trace's warm-cache run is `runTrace(..., warm)` on a clone of the session the cold run filled — computed in `useTraceState.computeTraceResult`, never stored mutably.
- Selection is derived through `sanitizeSelection`, so deleted ids vanish after edit/undo without effects. Entering or leaving a layer clears the selection.
- Styling: CSS Modules + Hannibal tokens only (`--paper`, `--ink`, `--rule`, `--accent*`). Category colours: client = `--accent-3`, backend = `--accent-4`, db = `--accent`, infra = `--ink-faint`; mismatch/danger = `--accent-2`. Dark mode comes from `useTheme()`.

## Tests

`vitest run src/pages/ArchTest` — engine (pure, fixture = `starter()`), view geometry, state hooks, canvas gestures/rendering, panels and overlays (each with a real-model harness: `components/panel/testHarness.tsx`, `components/overlays/testHarness.tsx`), and a page-level integration test.

## Known gaps (carried over from the prototype)

- No touch pinch-zoom.
- Export/import is a JSON text box; persistence is `localStorage` only (no backend save endpoint).
