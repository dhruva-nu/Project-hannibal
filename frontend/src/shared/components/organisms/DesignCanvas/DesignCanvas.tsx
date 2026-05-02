import { useLayoutEffect, useRef, useState } from "react";
import { BoardNode } from "@/shared/components/molecules/BoardNode/BoardNode";
import { ServiceBlock } from "@/shared/components/molecules/ServiceBlock/ServiceBlock";
import type {
  BoardNodeData,
  BoardEdge,
  PendingEdge,
  SelectedItem,
  PortPosition,
} from "@/pages/DesignBoard/boardTypes";
import styles from "./DesignCanvas.module.css";

interface EdgePath {
  id: string;
  d: string;
  isService: boolean;
}

interface DesignCanvasProps {
  nodes: Record<string, BoardNodeData>;
  edges: BoardEdge[];
  pending: PendingEdge | null;
  selected: SelectedItem | null;
  innerRef: React.RefObject<HTMLDivElement | null>;
  onNodeMove: (id: string, x: number, y: number) => void;
  onNodeSelect: (item: SelectedItem) => void;
  onEdgeSelect: (edgeId: string) => void;
  onCanvasClick: () => void;
  onPortPointerDown: (e: React.PointerEvent, nodeId: string, moduleId: string | undefined, port: PortPosition) => void;
  onPortPointerUp: (nodeId: string, moduleId: string | undefined, port: PortPosition) => void;
  onDrop: (kind: string, label: string, x: number, y: number) => void;
  onAddModule: (serviceId: string, label: string) => void;
}

export const DesignCanvas = ({
  nodes,
  edges,
  pending,
  selected,
  innerRef,
  onNodeMove,
  onNodeSelect,
  onEdgeSelect,
  onCanvasClick,
  onPortPointerDown,
  onPortPointerUp,
  onDrop,
  onAddModule,
}: DesignCanvasProps) => {
  const edgePathsRef = useRef<EdgePath[]>([]);
  const pendingPathRef = useRef<string>("");
  const [, setTick] = useState(0);

  useLayoutEffect(() => {
    const inner = innerRef.current;
    if (!inner) return;
    const ir = inner.getBoundingClientRect();

    const getAnchor = (nodeId: string, moduleId: string | undefined, port: PortPosition) => {
      const sel = moduleId
        ? `[data-service-id="${nodeId}"] [data-module-id="${moduleId}"]`
        : `[data-node-id="${nodeId}"], [data-service-id="${nodeId}"]`;
      const el = inner.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const x = r.left - ir.left;
      const y = r.top - ir.top;
      if (port === "l") return { x, y: y + r.height / 2 };
      if (port === "r") return { x: x + r.width, y: y + r.height / 2 };
      if (port === "t") return { x: x + r.width / 2, y };
      return { x: x + r.width / 2, y: y + r.height };
    };

    const newPaths: EdgePath[] = [];
    for (const e of edges) {
      const a = getAnchor(e.from.nodeId, e.from.moduleId, e.from.port);
      const b = getAnchor(e.to.nodeId, e.to.moduleId, e.to.port);
      if (!a || !b) continue;
      const dx = (b.x - a.x) * 0.4;
      const d = `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
      const isService =
        (!e.from.moduleId && nodes[e.from.nodeId]?.type === "service") ||
        (!e.to.moduleId && nodes[e.to.nodeId]?.type === "service");
      newPaths.push({ id: e.id, d, isService });
    }

    let newPendingPath = "";
    if (pending) {
      const a = getAnchor(pending.fromNodeId, pending.fromModuleId, pending.fromPort);
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

  const handleDragOver = (e: React.DragEvent) => e.preventDefault();

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const kind = e.dataTransfer.getData("kind");
    const label = e.dataTransfer.getData("label");
    if (!kind || !innerRef.current) return;
    const ir = innerRef.current.getBoundingClientRect();
    onDrop(kind, label, e.clientX - ir.left, e.clientY - ir.top);
  };

  const edgePaths = edgePathsRef.current;
  const pendingPath = pendingPathRef.current;

  return (
    <div className={styles.wrap}>
      <div className={styles.helpPill}>
        drag from palette · hover a node to see ports · drag port to connect
      </div>
      <div className={styles.frame} aria-hidden="true" />
      <div className={styles.label} aria-hidden="true">System design</div>

      <div
        className={styles.canvas}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={e => { if (e.target === e.currentTarget) onCanvasClick(); }}
        aria-label="Design canvas"
      >
        <div
          ref={innerRef}
          className={styles.inner}
          onClick={e => { if (e.target === e.currentTarget) onCanvasClick(); }}
        >
          <svg className={styles.svg} aria-hidden="true">
            <defs>
              <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--accent-3)" />
              </marker>
              <marker id="arrowDark" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--ink)" />
              </marker>
            </defs>

            {edgePaths.map(ep => (
              <path
                key={ep.id}
                className={`${styles.edge} ${ep.isService ? styles.edgeService : ""}`}
                d={ep.d}
                markerEnd={ep.isService ? "url(#arrowDark)" : "url(#arrow)"}
                onClick={e => { e.stopPropagation(); onEdgeSelect(ep.id); }}
                aria-label="Connection edge"
                role="button"
                tabIndex={0}
              />
            ))}
            {pendingPath && (
              <path className={styles.pendingEdge} d={pendingPath} />
            )}
          </svg>

          {Object.values(nodes).map(n =>
            n.type === "component" ? (
              <BoardNode
                key={n.id}
                node={n}
                selected={selected?.kind === "node" && selected.id === n.id}
                onSelect={onNodeSelect}
                onMove={onNodeMove}
                onPortPointerDown={onPortPointerDown}
                onPortPointerUp={onPortPointerUp}
              />
            ) : (
              <ServiceBlock
                key={n.id}
                service={n}
                selected={selected?.kind === "service" && selected.id === n.id}
                selectedModuleId={
                  selected?.kind === "module" && selected.id === n.id ? selected.moduleId : undefined
                }
                onSelect={onNodeSelect}
                onMove={onNodeMove}
                onPortPointerDown={onPortPointerDown}
                onPortPointerUp={onPortPointerUp}
                onAddModule={onAddModule}
              />
            ),
          )}
        </div>
      </div>
    </div>
  );
};
