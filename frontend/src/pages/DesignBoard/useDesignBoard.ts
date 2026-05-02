import { useState, useRef, useCallback, useEffect } from "react";
import type {
  BoardNodeData,
  BoardEdge,
  PendingEdge,
  SelectedItem,
  PortPosition,
} from "./boardTypes";

let uidCounter = 0;
const nextId = (prefix: string) => `${prefix}_${++uidCounter}`;

export function useDesignBoard() {
  const [nodes, setNodes] = useState<Record<string, BoardNodeData>>({});
  const [edges, setEdges] = useState<BoardEdge[]>([]);
  const [selected, setSelected] = useState<SelectedItem | null>(null);
  const [pending, setPending] = useState<PendingEdge | null>(null);

  const innerRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef<PendingEdge | null>(null);
  pendingRef.current = pending;

  const startEdge = useCallback(
    (e: React.PointerEvent, nodeId: string, moduleId: string | undefined, port: PortPosition) => {
      e.preventDefault();
      e.stopPropagation();
      if (!innerRef.current) return;
      const ir = innerRef.current.getBoundingClientRect();
      setPending({
        fromNodeId: nodeId,
        fromModuleId: moduleId,
        fromPort: port,
        x: e.clientX - ir.left,
        y: e.clientY - ir.top,
      });
    },
    [],
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
        {
          id: nextId("e"),
          from: { nodeId: p.fromNodeId, moduleId: p.fromModuleId, port: p.fromPort },
          to: { nodeId, moduleId, port },
        },
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
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [isPending]);

  const moveNode = useCallback((id: string, x: number, y: number) => {
    setNodes(prev => {
      const n = prev[id];
      if (!n) return prev;
      return { ...prev, [id]: { ...n, x, y } };
    });
  }, []);

  const findServiceAt = useCallback(
    (x: number, y: number): BoardNodeData | undefined => {
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
    },
    [nodes],
  );

  const handleDrop = useCallback(
    (kind: string, label: string, x: number, y: number) => {
      if (kind === "service") {
        const id = nextId("s");
        setNodes(prev => ({
          ...prev,
          [id]: { id, type: "service", x: x - 90, y: y - 50, w: 220, label: label || "Service", modules: [] },
        }));
        setSelected({ kind: "service", id });
      } else if (kind === "module") {
        const target = findServiceAt(x, y);
        if (target && (target.modules ?? []).length < 5) {
          setNodes(prev => {
            const s = prev[target.id];
            return {
              ...prev,
              [target.id]: { ...s, modules: [...(s.modules ?? []), { id: nextId("m"), label }] },
            };
          });
        }
      } else {
        const id = nextId("c");
        setNodes(prev => ({ ...prev, [id]: { id, type: "component", x: x - 50, y: y - 15, label } }));
        setSelected({ kind: "node", id });
      }
    },
    [findServiceAt],
  );

  const updateLabel = useCallback((nodeId: string, label: string, moduleId?: string) => {
    setNodes(prev => {
      const n = prev[nodeId];
      if (!n) return prev;
      if (moduleId) {
        return {
          ...prev,
          [nodeId]: { ...n, modules: (n.modules ?? []).map(m => (m.id === moduleId ? { ...m, label } : m)) },
        };
      }
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
    setNodes(prev => {
      const next = { ...prev };
      delete next[nodeId];
      return next;
    });
    setEdges(prev => prev.filter(e => e.from.nodeId !== nodeId && e.to.nodeId !== nodeId));
    setSelected(null);
  }, []);

  const deleteModule = useCallback((nodeId: string, moduleId: string) => {
    setNodes(prev => {
      const n = prev[nodeId];
      if (!n) return prev;
      return { ...prev, [nodeId]: { ...n, modules: (n.modules ?? []).filter(m => m.id !== moduleId) } };
    });
    setEdges(prev => prev.filter(e => e.from.moduleId !== moduleId && e.to.moduleId !== moduleId));
    setSelected(null);
  }, []);

  const deleteEdge = useCallback((edgeId: string) => {
    setEdges(prev => prev.filter(e => e.id !== edgeId));
    setSelected(null);
  }, []);

  const clearBoard = useCallback(() => {
    setNodes({});
    setEdges([]);
    setSelected(null);
    setPending(null);
  }, []);

  const exportJson = useCallback(() => {
    const data = JSON.stringify({ nodes, edges }, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "system-design.json";
    a.click();
    URL.revokeObjectURL(url);
  }, [nodes, edges]);

  const seed = useCallback(() => {
    const c1 = nextId("c");
    const s1 = nextId("s");
    const db = nextId("c");
    const rd = nextId("c");
    const ob = nextId("c");
    const authMod = nextId("m");
    const gw = nextId("m");
    setNodes({
      [c1]: { id: c1, type: "component", x: 60, y: 220, label: "Client" },
      [s1]: {
        id: s1,
        type: "service",
        x: 280,
        y: 150,
        w: 220,
        label: "BE",
        modules: [
          { id: authMod, label: "Auth Module" },
          { id: gw, label: "Gateway" },
        ],
      },
      [db]: { id: db, type: "component", x: 580, y: 150, label: "DB" },
      [rd]: { id: rd, type: "component", x: 580, y: 220, label: "Redis" },
      [ob]: { id: ob, type: "component", x: 360, y: 360, label: "OAuth Provider" },
    });
    setEdges([
      { id: nextId("e"), from: { nodeId: c1, port: "r" }, to: { nodeId: s1, port: "l" } },
      { id: nextId("e"), from: { nodeId: s1, moduleId: authMod, port: "r" }, to: { nodeId: db, port: "l" } },
      { id: nextId("e"), from: { nodeId: s1, moduleId: gw, port: "r" }, to: { nodeId: rd, port: "l" } },
      { id: nextId("e"), from: { nodeId: s1, port: "b" }, to: { nodeId: ob, port: "t" } },
    ]);
  }, []);

  return {
    nodes,
    edges,
    selected,
    pending,
    innerRef,
    setSelected,
    startEdge,
    finishEdge,
    moveNode,
    handleDrop,
    updateLabel,
    addModule,
    deleteNode,
    deleteModule,
    deleteEdge,
    clearBoard,
    exportJson,
    seed,
  };
}
