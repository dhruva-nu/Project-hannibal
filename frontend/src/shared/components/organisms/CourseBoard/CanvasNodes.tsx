import type { Lesson, CourseNodeDef, CourseEdgeDef } from "@/services/courseDetail";
import type { useCourseState } from "@/pages/CoursePage/useCourseState";
import styles from "./CourseBoard.module.css";

type CourseHook = ReturnType<typeof useCourseState>;

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

interface CanvasNodesProps {
  revealedNodes: Set<string>;
  revealedMods: Set<string>;
  nodeDefs: Record<string, CourseNodeDef>;
  buildStep: number;
  pendingPlacement: CourseHook["state"]["pendingPlacement"];
  activeLesson: Lesson | null;
}

export function CanvasNodes({ revealedNodes, revealedMods, nodeDefs, pendingPlacement }: CanvasNodesProps) {
  return (
    <>
      {Object.entries(nodeDefs).map(([id, n]) => {
        if (revealedNodes.has(id)) return null;
        return (
          <div
            key={`ghost-${id}`}
            className={[styles.ghost, n.kind === "service" ? styles.serviceGhost : ""].join(" ")}
            style={{ left: `${n.x}%`, top: `${n.y}%`, minWidth: n.kind !== "service" ? "70px" : undefined }}
          >?</div>
        );
      })}
      {Object.entries(nodeDefs).map(([id, n]) => {
        if (!revealedNodes.has(id)) return null;
        if (n.kind === "node") {
          return (
            <div key={id} className={[styles.node, styles.nodeShown].join(" ")}
              style={{ left: `${n.x}%`, top: `${n.y}%` }} data-nodeid={id}>
              {n.label}
            </div>
          );
        }
        return (
          <div key={id}
            className={[styles.service, styles.serviceShown].join(" ")}
            style={{ left: `${n.x}%`, top: `${n.y}%` }} data-nodeid={id}>
            <div className={styles.serviceModules}>
              {(n.modules ?? []).map(m => {
                const key = `${id}:${m.id}`;
                if (!revealedMods.has(key)) return null;
                const isPending = pendingPlacement?.kind === "module" && pendingPlacement.id === m.id && pendingPlacement.parent === id;
                return (
                  <div key={m.id}
                    className={[styles.module, styles.moduleShown, isPending ? styles.modulePending : ""].join(" ")}
                    data-modid={key}>{m.label}</div>
                );
              })}
            </div>
            <div className={styles.serviceLabel}>{n.label}</div>
          </div>
        );
      })}
    </>
  );
}
