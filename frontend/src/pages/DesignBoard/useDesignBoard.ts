import { useState, useRef, useCallback } from "react";
import type { BoardNodeData, SelectedItem } from "./boardTypes";
import { nextId, buildSeedData } from "./boardSeed";
import { useBoardEdges } from "./useBoardEdges";

export function useDesignBoard() {
  const [nodes, setNodes] = useState<Record<string, BoardNodeData>>({});
  const [selected, setSelected] = useState<SelectedItem | null>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const edges = useBoardEdges(innerRef);

  const moveNode = useCallback((id: string, x: number, y: number) => {
    setNodes(prev => { const n = prev[id]; return n ? { ...prev, [id]: { ...n, x, y } } : prev; });
  }, []);

  const findServiceAt = useCallback((x: number, y: number): BoardNodeData | undefined => {
    if (!innerRef.current) return undefined;
    const ir = innerRef.current.getBoundingClientRect();
    return Object.values(nodes).find(n => {
      if (n.type !== "service") return false;
      const el = innerRef.current!.querySelector(`[data-service-id="${n.id}"]`);
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const lx = r.left - ir.left;
      const ly = r.top - ir.top;
      return x >= lx && x <= lx + r.width && y >= ly && y <= ly + r.height;
    });
  }, [nodes]);

  const handleDrop = useCallback((kind: string, label: string, x: number, y: number) => {
    if (kind === "service") {
      const id = nextId("s");
      setNodes(prev => ({ ...prev, [id]: { id, type: "service", x: x - 90, y: y - 50, w: 220, label: label || "Service", modules: [] } }));
      setSelected({ kind: "service", id });
    } else if (kind === "module") {
      const target = findServiceAt(x, y);
      if (target && (target.modules ?? []).length < 5) {
        setNodes(prev => { const s = prev[target.id]; return { ...prev, [target.id]: { ...s, modules: [...(s.modules ?? []), { id: nextId("m"), label }] } }; });
      }
    } else {
      const id = nextId("c");
      setNodes(prev => ({ ...prev, [id]: { id, type: "component", x: x - 50, y: y - 15, label } }));
      setSelected({ kind: "node", id });
    }
  }, [findServiceAt]);

  const updateLabel = useCallback((nodeId: string, label: string, moduleId?: string) => {
    setNodes(prev => {
      const n = prev[nodeId];
      if (!n) return prev;
      if (moduleId) return { ...prev, [nodeId]: { ...n, modules: (n.modules ?? []).map(m => (m.id === moduleId ? { ...m, label } : m)) } };
      return { ...prev, [nodeId]: { ...n, label } };
    });
  }, []);

  const addModule = useCallback((serviceId: string, label: string) => {
    setNodes(prev => {
      const n = prev[serviceId];
      if (!n || (n.modules ?? []).length >= 5) return prev;
      return { ...prev, [serviceId]: { ...n, modules: [...(n.modules ?? []), { id: nextId("m"), label }] } };
    });
  }, []);

  const deleteNode = useCallback((nodeId: string) => {
    setNodes(prev => { const next = { ...prev }; delete next[nodeId]; return next; });
    edges.filterForNode(nodeId);
    setSelected(null);
  }, [edges]);

  const deleteModule = useCallback((nodeId: string, moduleId: string) => {
    setNodes(prev => { const n = prev[nodeId]; return n ? { ...prev, [nodeId]: { ...n, modules: (n.modules ?? []).filter(m => m.id !== moduleId) } } : prev; });
    edges.filterForModule(moduleId);
    setSelected(null);
  }, [edges]);

  const clearBoard = useCallback(() => { setNodes({}); edges.setEdges([]); setSelected(null); }, [edges]);

  const exportJson = useCallback(() => {
    const blob = new Blob([JSON.stringify({ nodes, edges: edges.edges }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "system-design.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }, [nodes, edges.edges]);

  const seed = useCallback(() => {
    const { nodes: seedNodes, edges: seedEdges } = buildSeedData();
    setNodes(seedNodes);
    edges.setEdges(seedEdges);
  }, [edges]);

  return {
    nodes, edges: edges.edges, selected, pending: edges.pending,
    innerRef, setSelected,
    startEdge: edges.startEdge, finishEdge: edges.finishEdge,
    moveNode, handleDrop, updateLabel, addModule,
    deleteNode, deleteModule, deleteEdge: edges.deleteEdge,
    clearBoard, exportJson, seed,
  };
}
