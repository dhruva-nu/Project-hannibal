import { useCallback, useEffect, useRef, useState } from "react";
import type { BoardEdge, PendingEdge, PortPosition } from "./boardTypes";
import { nextId } from "./boardSeed";

export function useBoardEdges(innerRef: React.RefObject<HTMLDivElement | null>) {
  const [edges, setEdges] = useState<BoardEdge[]>([]);
  const [pending, setPending] = useState<PendingEdge | null>(null);
  const pendingRef = useRef<PendingEdge | null>(null);
  pendingRef.current = pending;

  const startEdge = useCallback(
    (e: React.PointerEvent, nodeId: string, moduleId: string | undefined, port: PortPosition) => {
      e.preventDefault();
      e.stopPropagation();
      if (!innerRef.current) return;
      const ir = innerRef.current.getBoundingClientRect();
      setPending({ fromNodeId: nodeId, fromModuleId: moduleId, fromPort: port, x: e.clientX - ir.left, y: e.clientY - ir.top });
    },
    [innerRef],
  );

  const finishEdge = useCallback(
    (nodeId: string, moduleId: string | undefined, port: PortPosition) => {
      const p = pendingRef.current;
      if (!p) return;
      if (p.fromNodeId === nodeId && p.fromModuleId === moduleId && p.fromPort === port) {
        setPending(null);
        return;
      }
      setEdges(prev => [
        ...prev,
        { id: nextId("e"), from: { nodeId: p.fromNodeId, moduleId: p.fromModuleId, port: p.fromPort }, to: { nodeId, moduleId, port } },
      ]);
      setPending(null);
    },
    [],
  );

  const isPending = pending !== null;
  useEffect(() => {
    if (!isPending) return;
    const onMove = (e: PointerEvent) => {
      if (!innerRef.current) return;
      const ir = innerRef.current.getBoundingClientRect();
      setPending(p => (p ? { ...p, x: e.clientX - ir.left, y: e.clientY - ir.top } : null));
    };
    const onUp = () => setPending(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
  }, [isPending, innerRef]);

  const deleteEdge = useCallback((edgeId: string) => setEdges(prev => prev.filter(e => e.id !== edgeId)), []);
  const filterForNode = useCallback((nodeId: string) => setEdges(prev => prev.filter(e => e.from.nodeId !== nodeId && e.to.nodeId !== nodeId)), []);
  const filterForModule = useCallback((moduleId: string) => setEdges(prev => prev.filter(e => e.from.moduleId !== moduleId && e.to.moduleId !== moduleId)), []);

  return { edges, setEdges, pending, startEdge, finishEdge, deleteEdge, filterForNode, filterForModule };
}
