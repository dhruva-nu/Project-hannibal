import { useLayoutEffect, useRef, useState } from "react";
import type { BoardNodeData, BoardEdge, PendingEdge, PortPosition } from "@/pages/DesignBoard/boardTypes";

export interface EdgePath { id: string; d: string; isService: boolean; }

function getAnchor(inner: HTMLDivElement, nodeId: string, moduleId: string | undefined, port: PortPosition) {
  const ir = inner.getBoundingClientRect();
  const sel = moduleId ? `[data-service-id="${nodeId}"] [data-module-id="${moduleId}"]` : `[data-node-id="${nodeId}"], [data-service-id="${nodeId}"]`;
  const el = inner.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const x = r.left - ir.left;
  const y = r.top - ir.top;
  if (port === "l") return { x, y: y + r.height / 2 };
  if (port === "r") return { x: x + r.width, y: y + r.height / 2 };
  if (port === "t") return { x: x + r.width / 2, y };
  return { x: x + r.width / 2, y: y + r.height };
}

function buildCubic(a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = (b.x - a.x) * 0.4;
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}

export function useEdgePaths(
  nodes: Record<string, BoardNodeData>,
  edges: BoardEdge[],
  pending: PendingEdge | null,
  innerRef: React.RefObject<HTMLDivElement | null>,
) {
  const edgePathsRef = useRef<EdgePath[]>([]);
  const pendingPathRef = useRef<string>("");
  const [, setTick] = useState(0);

  useLayoutEffect(() => {
    const inner = innerRef.current;
    if (!inner) return;

    const newPaths: EdgePath[] = [];
    for (const e of edges) {
      const a = getAnchor(inner, e.from.nodeId, e.from.moduleId, e.from.port);
      const b = getAnchor(inner, e.to.nodeId, e.to.moduleId, e.to.port);
      if (!a || !b) continue;
      const isService = (!e.from.moduleId && nodes[e.from.nodeId]?.type === "service") || (!e.to.moduleId && nodes[e.to.nodeId]?.type === "service");
      newPaths.push({ id: e.id, d: buildCubic(a, b), isService });
    }

    let newPendingPath = "";
    if (pending) {
      const a = getAnchor(inner, pending.fromNodeId, pending.fromModuleId, pending.fromPort);
      if (a) newPendingPath = `M ${a.x} ${a.y} L ${pending.x} ${pending.y}`;
    }

    const prevStr = JSON.stringify(edgePathsRef.current) + pendingPathRef.current;
    const nextStr = JSON.stringify(newPaths) + newPendingPath;
    if (prevStr !== nextStr) {
      edgePathsRef.current = newPaths;
      pendingPathRef.current = newPendingPath;
      setTick(t => t + 1);
    }
  }, [nodes, edges, pending, innerRef]);

  return { edgePaths: edgePathsRef.current, pendingPath: pendingPathRef.current };
}
