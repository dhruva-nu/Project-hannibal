import { descendants, node as nodeOf } from "../../../engine";
import type { ArchModel } from "../../../engine";
import { NO_SELECTION } from "../../../state/archApi";
import { moveNodesTo, reparentAll } from "../../../state/structure";
import { snapToGrid, toWorld, type Point } from "../../../view/geometry";
import { DOUBLE_CLICK_MS, hasMoved, type GestureContext, type PointerLike } from "./gestureContext";
import { trackPointer } from "./track";

type Positions = Record<string, Point>;

const pointerWorld = (ctx: GestureContext, event: PointerLike): Point => {
  const rect = ctx.viewportRect();
  return toWorld(ctx.view, event.clientX - rect.left, event.clientY - rect.top);
};

const originsOf = (model: ArchModel, ids: Iterable<string>): Positions => {
  const origins: Positions = {};
  for (const id of ids) {
    const target = nodeOf(model, id);
    if (target) origins[id] = { x: target.x, y: target.y };
  }
  return origins;
};

const shiftedPositions = (origins: Positions, dx: number, dy: number): Positions =>
  Object.fromEntries(
    Object.entries(origins).map(([id, origin]) => [id, { x: snapToGrid(origin.x + dx), y: snapToGrid(origin.y + dy) }]),
  );

interface DragPlan {
  start: PointerLike;
  origins: Positions;
  onClick: () => void;
  onDrop: (draft: ArchModel, positions: Positions) => void;
}

/** Shared drag loop: below the threshold it is a click, above it moves everything in `origins`. */
const runDrag = (ctx: GestureContext, plan: DragPlan): void => {
  const startWorld = pointerWorld(ctx, plan.start);
  let latest: Positions | null = null;
  trackPointer(
    (move) => {
      if (!latest && !hasMoved(plan.start, move)) return;
      const here = pointerWorld(ctx, move);
      latest = shiftedPositions(plan.origins, here.x - startWorld.x, here.y - startWorld.y);
      ctx.setOverrides({ positions: latest, sizes: {} });
    },
    () => {
      ctx.setOverrides(null);
      if (!latest) {
        plan.onClick();
        return;
      }
      const dropped = latest;
      ctx.commit((draft) => plan.onDrop(draft, dropped));
    },
  );
};

const toggleSelection = (ctx: GestureContext, nodeId: string): void => {
  const current = ctx.selection.type === "node" ? [...ctx.selection.ids] : [];
  const index = current.indexOf(nodeId);
  if (index >= 0) current.splice(index, 1);
  else current.push(nodeId);
  ctx.select(current.length ? { type: "node", ids: current } : NO_SELECTION);
};

const registerClick = (ctx: GestureContext, nodeId: string): void => {
  const now = ctx.now();
  const isDouble = ctx.lastClick.id === nodeId && now - ctx.lastClick.time < DOUBLE_CLICK_MS;
  ctx.lastClick.id = isDouble ? null : nodeId;
  ctx.lastClick.time = isDouble ? 0 : now;
  if (isDouble) ctx.openDetail(nodeId);
};

const startLayerCardDrag = (ctx: GestureContext, start: PointerLike, layerCardId: string): void => {
  const layer = ctx.model.lnodes.find((n) => n.id === layerCardId);
  if (!layer) return;
  runDrag(ctx, {
    start,
    origins: originsOf(ctx.model, [layerCardId]),
    onClick: () => ctx.openScope(layer.lid),
    onDrop: moveNodesTo,
  });
};

export const startNodeDrag = (ctx: GestureContext, start: PointerLike, nodeId: string): void => {
  const target = nodeOf(ctx.model, nodeId);
  if (!target) return;
  if (target.type === "layer") {
    startLayerCardDrag(ctx, start, nodeId);
    return;
  }
  if (start.shiftKey) {
    toggleSelection(ctx, nodeId);
    return;
  }
  const alreadySelected = ctx.selection.type === "node" && ctx.selection.ids.includes(nodeId);
  const selectedIds = alreadySelected ? [...ctx.selection.ids] : [nodeId];
  if (!alreadySelected) ctx.select({ type: "node", ids: selectedIds });
  const moving = new Set(selectedIds);
  selectedIds.forEach((id) => descendants(ctx.model, id).forEach((d) => moving.add(d)));
  runDrag(ctx, {
    start,
    origins: originsOf(ctx.model, moving),
    onClick: () => {
      if (selectedIds.length > 1) ctx.select({ type: "node", ids: [nodeId] });
      registerClick(ctx, nodeId);
    },
    onDrop: (draft, positions) => {
      moveNodesTo(draft, positions);
      reparentAll(draft, selectedIds);
    },
  });
};

export const startGroupDrag = (ctx: GestureContext, start: PointerLike, groupId: string): void => {
  ctx.select({ type: "group", ids: [groupId] });
  const memberIds = ctx.model.nodes.filter((n) => n.group === groupId).map((n) => n.id);
  runDrag(ctx, {
    start,
    origins: originsOf(ctx.model, memberIds),
    onClick: () => undefined,
    onDrop: moveNodesTo,
  });
};
