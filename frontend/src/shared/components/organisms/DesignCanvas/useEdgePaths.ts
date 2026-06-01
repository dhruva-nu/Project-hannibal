import { useLayoutEffect, useState } from "react";
import type { BoardNodeData, BoardEdge, PendingEdge, PortPosition } from "@/shared/types/board";
import { anchorOnElement, buildCubicPath, type Point } from "@/shared/utils/edgePath";

export interface EdgePath { id: string; d: string; isService: boolean; }

function getAnchor(inner: HTMLDivElement, nodeId: string, moduleId: string | undefined, port: PortPosition): Point | null {
  const sel = moduleId
    ? `[data-service-id="${nodeId}"] [data-module-id="${moduleId}"]`
    : `[data-node-id="${nodeId}"], [data-service-id="${nodeId}"]`;
  return anchorOnElement(inner, sel, port);
}

export function useEdgePaths(
  nodes: Record<string, BoardNodeData>,
  edges: BoardEdge[],
  pending: PendingEdge | null,
  innerRef: React.RefObject<HTMLDivElement | null>,
) {
  const [edgePaths, setEdgePaths] = useState<EdgePath[]>([]);
  const [pendingPath, setPendingPath] = useState<string>("");

  useLayoutEffect(() => {
    const inner = innerRef.current;
    if (!inner) return;

    const newPaths: EdgePath[] = [];
    for (const e of edges) {
      const a = getAnchor(inner, e.from.nodeId, e.from.moduleId, e.from.port);
      const b = getAnchor(inner, e.to.nodeId, e.to.moduleId, e.to.port);
      if (!a || !b) continue;
      const isService = (!e.from.moduleId && nodes[e.from.nodeId]?.type === "service") || (!e.to.moduleId && nodes[e.to.nodeId]?.type === "service");
      newPaths.push({ id: e.id, d: buildCubicPath(a, b), isService });
    }

    let newPendingPath = "";
    if (pending) {
      const a = getAnchor(inner, pending.fromNodeId, pending.fromModuleId, pending.fromPort);
      if (a) newPendingPath = `M ${a.x} ${a.y} L ${pending.x} ${pending.y}`;
    }

    setEdgePaths(newPaths);
    setPendingPath(newPendingPath);
  }, [nodes, edges, pending, innerRef]);

  return { edgePaths, pendingPath };
}
