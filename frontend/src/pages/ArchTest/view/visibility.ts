import type { AnyEdge, ArchEdge, ArchModel, ArchNode, DerivedEdge, LayerId } from "../engine";
import { isContainer, node as nodeOf } from "../engine";
import { boundsOf, snapToGrid, type Box } from "./geometry";

export interface GhostBox extends Box {
  up: boolean;
}

export interface Visibility {
  edges: AnyEdge[];
  ghosts: Record<string, GhostBox>;
  derivedById: Record<string, DerivedEdge>;
}

const LAYER_ORDER: Record<LayerId, number> = { client: 0, backend: 1, db: 2 };
const GHOST_WIDTH = 240;
const GHOST_HEIGHT = 40;
const GHOST_SLOT_GAP = 250;
const GHOST_SLOT_STEP = 260;
const MAX_SLOT_SEARCH = 30;
const FALLBACK_BOUNDS = { minX: 0, maxX: 600, minY: 0, maxY: 300 };

export const isVisible = (n: ArchNode, scope: LayerId | null): boolean =>
  scope ? n.layer === scope : n.type === "layer" || !n.layer;

export const visibleNodes = (model: ArchModel, scope: LayerId | null): ArchNode[] =>
  scope ? model.nodes.filter((n) => n.layer === scope) : [...model.lnodes, ...model.nodes.filter((n) => !n.layer)];

export const visibleContainers = (model: ArchModel, scope: LayerId | null): ArchNode[] =>
  visibleNodes(model, scope).filter(isContainer);

export const visibleCards = (model: ArchModel, scope: LayerId | null): ArchNode[] =>
  visibleNodes(model, scope).filter((n) => !isContainer(n));

const overviewEndpointId = (n: ArchNode): string => (n.layer ? `L_${n.layer}` : n.id);

const deriveOverviewEdges = (model: ArchModel): DerivedEdge[] => {
  const byKey: Record<string, DerivedEdge> = {};
  model.edges.forEach((edge) => {
    const from = nodeOf(model, edge.from);
    const to = nodeOf(model, edge.to);
    if (!from || !to) return;
    const fromId = overviewEndpointId(from);
    const toId = overviewEndpointId(to);
    if (fromId === toId) return;
    const key = `${fromId}|${toId}`;
    const derived = (byKey[key] = byKey[key] ?? {
      id: `ov|${key}`,
      from: fromId,
      to: toId,
      label: "",
      map: [],
      derived: true,
      ids: [],
    });
    derived.ids.push(edge.id);
  });
  return Object.values(byKey);
};

const boundsOrFallback = (boxes: Box[]) => boundsOf(boxes) ?? FALLBACK_BOUNDS;

interface GhostRows {
  up: number[];
  down: number[];
}

const placeGhost = (
  rows: GhostRows,
  external: ArchNode,
  local: ArchNode,
  scope: LayerId,
  localIsFrom: boolean,
  bounds: typeof FALLBACK_BOUNDS,
): GhostBox => {
  const up = external.layer ? LAYER_ORDER[external.layer] < LAYER_ORDER[scope] : !localIsFrom;
  const row = up ? rows.up : rows.down;
  let x = snapToGrid(local.x + local.w / 2 - GHOST_WIDTH / 2);
  const y = up ? bounds.minY - 110 : bounds.maxY + 80;
  let attempts = 0;
  while (attempts++ < MAX_SLOT_SEARCH && row.some((taken) => Math.abs(taken - x) < GHOST_SLOT_GAP)) x += GHOST_SLOT_STEP;
  row.push(x);
  return { x, y, w: GHOST_WIDTH, h: GHOST_HEIGHT, up };
};

const scopedEdgesWithGhosts = (model: ArchModel, scope: LayerId) => {
  const ghosts: Record<string, GhostBox> = {};
  const edges: ArchEdge[] = [];
  const rows: GhostRows = { up: [], down: [] };
  const bounds = boundsOrFallback(visibleNodes(model, scope));
  model.edges.forEach((edge) => {
    const from = nodeOf(model, edge.from);
    const to = nodeOf(model, edge.to);
    if (!from || !to) return;
    const fromInside = from.layer === scope;
    const toInside = to.layer === scope;
    if (!fromInside && !toInside) return;
    edges.push(edge);
    if (fromInside && toInside) return;
    const external = fromInside ? to : from;
    const local = fromInside ? from : to;
    if (ghosts[external.id]) return;
    ghosts[external.id] = placeGhost(rows, external, local, scope, fromInside, bounds);
  });
  return { edges, ghosts };
};

export const computeVisibility = (model: ArchModel, scope: LayerId | null): Visibility => {
  if (!scope) {
    const derived = deriveOverviewEdges(model);
    return {
      edges: derived,
      ghosts: {},
      derivedById: Object.fromEntries(derived.map((edge) => [edge.id, edge])),
    };
  }
  const { edges, ghosts } = scopedEdgesWithGhosts(model, scope);
  return { edges, ghosts, derivedById: {} };
};

export const boxOfNodeOrGhost =
  (model: ArchModel, ghosts: Record<string, GhostBox>) =>
  (id: string): Box | undefined =>
    ghosts[id] ?? nodeOf(model, id);
