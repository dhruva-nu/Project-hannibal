import type { CourseNodeDef, CourseEdgeDef } from "@/services/courseDetail";
import type { PlacedEdge } from "@/pages/CoursePage/placement";

export interface Anchor { x: number; y: number; }

export function getAnchor(canvas: HTMLElement, nodeId: string, modId: string | undefined, port: string): Anchor | null {
  const sel = modId
    ? `.service[data-nodeid="${nodeId}"] .module[data-modid="${nodeId}:${modId}"]`
    : `[data-nodeid="${nodeId}"]`;
  const el = canvas.querySelector<HTMLElement>(sel);
  if (!el) return null;
  const cr = canvas.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const x = r.left - cr.left;
  const y = r.top - cr.top;
  if (port === "l") return { x, y: y + r.height / 2 };
  if (port === "r") return { x: x + r.width, y: y + r.height / 2 };
  if (port === "t") return { x: x + r.width / 2, y };
  if (port === "b") return { x: x + r.width / 2, y: y + r.height };
  return { x: x + r.width / 2, y: y + r.height / 2 };
}

export function ghostAnchor(
  canvas: HTMLElement,
  nodeDefs: Record<string, CourseNodeDef>,
  nodeId: string,
  modId: string | undefined,
  port: string,
): Anchor | null {
  const real = getAnchor(canvas, nodeId, modId, port);
  if (real) return real;
  const n = nodeDefs[nodeId];
  if (!n) return null;
  return { x: (n.x / 100) * canvas.clientWidth, y: (n.y / 100) * canvas.clientHeight };
}

export function buildPath(a: Anchor, b: Anchor): string {
  const dx = (b.x - a.x) * 0.4;
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}

export function buildEdgePaths(
  canvas: HTMLElement,
  nodeDefs: Record<string, CourseNodeDef>,
  edgeDefs: CourseEdgeDef[],
  revealedNodes: Set<string>,
  revealedEdges: Set<string>,
  revealedMods: Set<string>,
): { id: string; d: string; ghost: boolean }[] {
  const paths: { id: string; d: string; ghost: boolean }[] = [];
  edgeDefs.forEach(e => {
    if (revealedEdges.has(e.id)) return;
    if (!revealedNodes.has(e.from) && !revealedNodes.has(e.to)) return;
    const a = ghostAnchor(canvas, nodeDefs, e.from, e.fromMod, e.fromPort);
    const b = ghostAnchor(canvas, nodeDefs, e.to, undefined, e.toPort);
    if (a && b) paths.push({ id: `ghost-${e.id}`, d: buildPath(a, b), ghost: true });
  });
  edgeDefs.forEach(e => {
    if (!revealedEdges.has(e.id) || !revealedNodes.has(e.from) || !revealedNodes.has(e.to)) return;
    if (e.fromMod && !revealedMods.has(`${e.from}:${e.fromMod}`)) return;
    const a = getAnchor(canvas, e.from, e.fromMod, e.fromPort);
    const b = getAnchor(canvas, e.to, undefined, e.toPort);
    if (a && b) paths.push({ id: e.id, d: buildPath(a, b), ghost: false });
  });
  return paths;
}

function placedAnchor(canvas: HTMLElement, nodeId: string, side: "l" | "r"): Anchor | null {
  const el = canvas.querySelector<HTMLElement>(
    `[data-node-id="${nodeId}"], [data-service-id="${nodeId}"]`,
  );
  if (!el) return null;
  const cr = canvas.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const x = r.left - cr.left;
  const y = r.top - cr.top;
  return side === "l"
    ? { x, y: y + r.height / 2 }
    : { x: x + r.width, y: y + r.height / 2 };
}

export function buildPlacedEdgePaths(
  canvas: HTMLElement,
  edges: PlacedEdge[],
): { id: string; d: string; ghost: boolean }[] {
  const paths: { id: string; d: string; ghost: boolean }[] = [];
  for (const edge of edges) {
    const from = placedAnchor(canvas, edge.from, "r");
    const to = placedAnchor(canvas, edge.to, "l");
    if (!from || !to) continue;
    paths.push({ id: `placed-${edge.id}`, d: buildPath(from, to), ghost: false });
  }
  return paths;
}
