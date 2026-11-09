import type { AnyEdge, ArchEdge, ArchModel, FnTrigger, Group, InfraType, LayerId, PlacedNode, PlacedType } from "../engine";
import {
  isContainer,
  mkEdge,
  mkNode,
  node as nodeOf,
  normalize,
  REG,
  reach,
  reparent,
  uid,
  uniqueName,
} from "../engine";
import { boxesOverlap, snapToGrid, type Point, type Viewport } from "../view/geometry";
import { visibleNodes } from "../view/visibility";

const PLACEMENT_ATTEMPTS = 80;
const PLACEMENT_GAP = 30;
const NODES_PER_ROW = 8;

export interface ViewportSize {
  width: number;
  height: number;
}

const findFreeSlot = (model: ArchModel, scope: LayerId | null, type: PlacedType, center: Point): Point => {
  const entry = REG[type];
  const start = { x: snapToGrid(center.x - entry.w / 2), y: snapToGrid(center.y - entry.h / 2) };
  const occupied = visibleNodes(model, scope).filter((n) => !isContainer(n));
  let { x, y } = start;
  for (let attempt = 1; attempt <= PLACEMENT_ATTEMPTS; attempt++) {
    if (!occupied.some((n) => boxesOverlap(n, { x, y, w: entry.w, h: entry.h }))) break;
    x += entry.w + PLACEMENT_GAP;
    if (attempt % NODES_PER_ROW === 0) {
      x = start.x;
      y += entry.h + PLACEMENT_GAP;
    }
  }
  return { x, y };
};

export const addNodeToModel = (
  draft: ArchModel,
  type: PlacedType,
  scope: LayerId | null,
  view: Viewport,
  size: ViewportSize,
): PlacedNode => {
  const entry = REG[type];
  const center = { x: (size.width / 2 - view.x) / view.k, y: (size.height / 2 - view.y) / view.k };
  const slot = findFreeSlot(draft, scope, type, center);
  const created = mkNode(type, slot.x, slot.y, { layer: scope ?? entry.layer ?? null });
  created.name = uniqueName(draft, entry.label);
  draft.nodes.push(created);
  reparent(draft, created);
  normalize(draft);
  return created;
};

export const hasEdge = (model: ArchModel, from: string, to: string): boolean =>
  model.edges.some((e) => e.from === from && e.to === to);

/** Point a function at an endpoint of the service it was connected to: the dropped row, else its current or first one. */
export const linkFunctionToEndpoint = (draft: ArchModel, fromId: string, toId: string, endpointId = ""): void => {
  const fn = nodeOf(draft, fromId);
  const service = nodeOf(draft, toId);
  if (fn?.type !== "function" || service?.type !== "service") return;
  const owns = (id: string) => service.cfg.endpoints.some((e) => e.id === id);
  if (owns(endpointId)) fn.cfg.endpoint = endpointId;
  else if (!owns(fn.cfg.endpoint)) fn.cfg.endpoint = service.cfg.endpoints[0]?.id ?? "";
};

export const addEdgeToModel = (draft: ArchModel, from: string, to: string, endpointId = ""): ArchEdge | null => {
  if (from === to || hasEdge(draft, from, to)) return null;
  const created = mkEdge(from, to);
  draft.edges.push(created);
  linkFunctionToEndpoint(draft, from, to, endpointId);
  normalize(draft);
  return created;
};

export const realEdgesOf = (model: ArchModel, edge: AnyEdge): ArchEdge[] =>
  edge.derived
    ? edge.ids.map((id) => model.edges.find((e) => e.id === id)).filter((e): e is ArchEdge => Boolean(e))
    : [edge];

const dedupeEdges = (edges: ArchEdge[]): ArchEdge[] => {
  const seen = new Set<string>();
  return edges.filter((e) => {
    const key = `${e.from}|${e.to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const insertInfraOnEdge = (
  draft: ArchModel,
  edge: AnyEdge,
  type: InfraType,
  middle: Point,
  scope: LayerId | null,
): PlacedNode => {
  const entry = REG[type];
  const inserted = mkNode(type, snapToGrid(middle.x - entry.w / 2), snapToGrid(middle.y - entry.h / 2), {
    layer: scope ?? null,
  });
  inserted.name = uniqueName(draft, entry.label);
  draft.nodes.push(inserted);
  realEdgesOf(draft, edge).forEach((real) => {
    const originalTarget = real.to;
    real.to = inserted.id;
    draft.edges.push(mkEdge(inserted.id, originalTarget));
  });
  draft.edges = dedupeEdges(draft.edges);
  normalize(draft);
  return inserted;
};

const clearUnreachableEndpointDatabases = (draft: ArchModel, removed: ArchEdge[]) => {
  removed.forEach((edge) => {
    const source = nodeOf(draft, edge.from);
    if (source?.type !== "service") return;
    const reachable = new Set(reach(draft, source.id, "fwd", ["sqldb", "nosql"]).map((d) => d.id));
    source.cfg.endpoints.forEach((endpoint) => {
      if (endpoint.dbId === edge.to && !reachable.has(edge.to)) endpoint.dbId = "";
    });
  });
};

export const removeEdges = (draft: ArchModel, edgeIds: string[]): void => {
  const removed = draft.edges.filter((e) => edgeIds.includes(e.id));
  draft.edges = draft.edges.filter((e) => !edgeIds.includes(e.id));
  clearUnreachableEndpointDatabases(draft, removed);
  normalize(draft);
};

export const removeNodes = (draft: ArchModel, nodeIds: string[]): void => {
  draft.nodes = draft.nodes.filter((n) => !nodeIds.includes(n.id));
  draft.edges = draft.edges.filter((e) => !nodeIds.includes(e.from) && !nodeIds.includes(e.to));
  normalize(draft);
};

export const groupNodes = (draft: ArchModel, nodeIds: string[]): Group => {
  const group: Group = { id: uid("g"), name: `Group ${draft.groups.length + 1}` };
  draft.groups.push(group);
  draft.nodes.forEach((n) => {
    if (nodeIds.includes(n.id)) n.group = group.id;
  });
  normalize(draft);
  return group;
};

export const ungroupNodes = (draft: ArchModel, groupId: string): void => {
  draft.nodes.forEach((n) => {
    if (n.group === groupId) n.group = null;
  });
  normalize(draft);
};

export const flipEdgeDirection = (draft: ArchModel, edgeId: string): boolean => {
  const edge = draft.edges.find((e) => e.id === edgeId);
  if (!edge) return false;
  [edge.from, edge.to] = [edge.to, edge.from];
  normalize(draft);
  return true;
};

const FUNCTION_NAME_BASE: Record<FnTrigger, string> = {
  "Initial Load": "fetchData",
  "On Load": "fetchData",
  "On Component Change": "fetchData",
  Polling: "poll",
  WebSocket: "subscribe",
};

export const addFunctionToComponent = (draft: ArchModel, componentId: string, trigger: FnTrigger): PlacedNode | null => {
  const component = draft.nodes.find((n) => n.id === componentId);
  if (!component) return null;
  const created = mkNode("function", component.x + 20, component.y + component.h + 50);
  if (created.type !== "function") return null;
  created.cfg.trigger = trigger;
  created.name = uniqueName(draft, FUNCTION_NAME_BASE[trigger]);
  draft.nodes.push(created);
  draft.edges.push(mkEdge(component.id, created.id));
  normalize(draft);
  return created;
};

export const moveNodesTo = (draft: ArchModel, positions: Record<string, Point>): void => {
  Object.entries(positions).forEach(([id, point]) => {
    const target = nodeOf(draft, id);
    if (!target) return;
    target.x = point.x;
    target.y = point.y;
  });
};

export const reparentAll = (draft: ArchModel, nodeIds: string[]): void => {
  nodeIds.forEach((id) => reparent(draft, nodeOf(draft, id)));
};
