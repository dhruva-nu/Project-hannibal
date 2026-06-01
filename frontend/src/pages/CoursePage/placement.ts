import type { BoardNodeData, BoardModule } from "../DesignBoard/boardTypes";
import type { NodeRecord } from "../../services/nodes";

export interface PlacedEdge {
  id: string;
  from: string;
  to: string;
}

const DEFAULT_NODE_X = 360;
const DEFAULT_NODE_Y = 200;
const PLACEMENT_OFFSET_STEP = 40;

function nextPlacementPosition(existing: Record<string, BoardNodeData>) {
  const count = Object.keys(existing).length;
  return {
    x: DEFAULT_NODE_X + count * PLACEMENT_OFFSET_STEP,
    y: DEFAULT_NODE_Y + count * PLACEMENT_OFFSET_STEP,
  };
}

function toBoardNode(record: NodeRecord, fallback: { x: number; y: number }): BoardNodeData {
  if (record.type === "module") {
    throw new Error("toBoardNode should not be called with a module node");
  }
  return {
    id: record.id,
    type: record.type,
    label: record.label,
    x: record.defaultX ?? fallback.x,
    y: record.defaultY ?? fallback.y,
    w: record.defaultW ?? undefined,
    modules: record.type === "service" ? [] : undefined,
  };
}

export function withPlacement(
  prev: Record<string, BoardNodeData>,
  node: NodeRecord,
  parent: NodeRecord | null,
): Record<string, BoardNodeData> {
  const next = { ...prev };

  if (node.type === "module") {
    if (!parent) return prev;
    const parentNode = next[parent.id] ?? toBoardNode(parent, nextPlacementPosition(next));
    const modules: BoardModule[] = parentNode.modules ? [...parentNode.modules] : [];
    if (!modules.some(m => m.id === node.id)) {
      modules.push({ id: node.id, label: node.label });
    }
    next[parent.id] = { ...parentNode, modules };
    return next;
  }

  if (!next[node.id]) {
    next[node.id] = toBoardNode(node, nextPlacementPosition(next));
  }
  return next;
}

export function applyPlacementNodes(
  prev: Record<string, BoardNodeData>,
  nodes: NodeRecord[],
): Record<string, BoardNodeData> {
  const byId = new Map(nodes.map(n => [n.id, n]));
  let next = prev;
  for (const node of nodes) {
    if (node.type === "module") continue;
    next = withPlacement(next, node, null);
  }
  for (const node of nodes) {
    if (node.type !== "module") continue;
    const parent = node.parentId ? byId.get(node.parentId) ?? null : null;
    next = withPlacement(next, node, parent);
  }
  return next;
}

export function extractEdges(nodes: NodeRecord[]): PlacedEdge[] {
  const edges: PlacedEdge[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    for (const targetId of node.linkedNodeIds) {
      const id = `${node.id}->${targetId}`;
      if (seen.has(id)) continue;
      seen.add(id);
      edges.push({ id, from: node.id, to: targetId });
    }
  }
  return edges;
}

export function mergeEdges(prev: PlacedEdge[], next: PlacedEdge[]): PlacedEdge[] {
  const byId = new Map(prev.map(e => [e.id, e]));
  for (const edge of next) byId.set(edge.id, edge);
  return Array.from(byId.values());
}
