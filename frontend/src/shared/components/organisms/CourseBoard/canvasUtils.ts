import type { CourseNodeDef, CourseEdgeDef } from "@/services/courseDetail";
import type { PlacedEdge } from "@/shared/types/board";
import { anchorOnElement, anchorOnRect, buildCubicPath, type Point } from "@/shared/utils/edgePath";

export type Anchor = Point;

export function getAnchor(canvas: HTMLElement, nodeId: string, modId: string | undefined, port: string): Anchor | null {
  const sel = modId
    ? `.service[data-nodeid="${nodeId}"] .module[data-modid="${nodeId}:${modId}"]`
    : `[data-nodeid="${nodeId}"]`;
  return anchorOnElement(canvas, sel, port as "l" | "r" | "t" | "b" | "c");
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

export const buildPath = buildCubicPath;

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
    if (a && b) paths.push({ id: `ghost-${e.id}`, d: buildCubicPath(a, b), ghost: true });
  });
  edgeDefs.forEach(e => {
    if (!revealedEdges.has(e.id) || !revealedNodes.has(e.from) || !revealedNodes.has(e.to)) return;
    if (e.fromMod && !revealedMods.has(`${e.from}:${e.fromMod}`)) return;
    const a = getAnchor(canvas, e.from, e.fromMod, e.fromPort);
    const b = getAnchor(canvas, e.to, undefined, e.toPort);
    if (a && b) paths.push({ id: e.id, d: buildCubicPath(a, b), ghost: false });
  });
  return paths;
}

function placedAnchor(canvas: HTMLElement, nodeId: string, side: "l" | "r"): Anchor | null {
  const el = canvas.querySelector<HTMLElement>(
    `[data-node-id="${nodeId}"], [data-service-id="${nodeId}"]`,
  );
  if (!el) return null;
  const cr = canvas.getBoundingClientRect();
  return anchorOnRect(el.getBoundingClientRect(), cr.left, cr.top, side);
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
    paths.push({ id: `placed-${edge.id}`, d: buildCubicPath(from, to), ghost: false });
  }
  return paths;
}
