import { useCallback, useEffect, useRef, useState } from "react";
import { DiagramNode } from "@/shared/components/molecules";
import type { DiagramEdge, DiagramNodeData } from "@/shared/types";
import styles from "./DiagramArea.module.css";

interface NodeCenter {
  x: number;
  y: number;
  w: number;
  h: number;
}

function getNodeCenter(areaEl: HTMLDivElement, nodeId: string): NodeCenter | null {
  const el = areaEl.querySelector<HTMLElement>(`[data-id="${nodeId}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const ar = areaEl.getBoundingClientRect();
  return {
    x: r.left - ar.left + r.width / 2,
    y: r.top - ar.top + r.height / 2,
    w: r.width,
    h: r.height,
  };
}

function edgePoint(c: NodeCenter, tx: number, ty: number) {
  const dx = tx - c.x;
  const dy = ty - c.y;
  if (dx === 0 && dy === 0) return { x: c.x, y: c.y };
  const hw = c.w / 2;
  const hh = c.h / 2;
  const sx = dx === 0 ? Infinity : hw / Math.abs(dx);
  const sy = dy === 0 ? Infinity : hh / Math.abs(dy);
  const s = Math.min(sx, sy);
  return { x: c.x + dx * s, y: c.y + dy * s };
}

function buildEdgePath(areaEl: HTMLDivElement, edge: DiagramEdge, index: number): string | null {
  const a = getNodeCenter(areaEl, edge.from);
  const b = getNodeCenter(areaEl, edge.to);
  if (!a || !b) return null;
  const p1 = edgePoint(a, b.x, b.y);
  const p2 = edgePoint(b, a.x, a.y);
  const cx = (p1.x + p2.x) / 2;
  const cy = (p1.y + p2.y) / 2 - 14 - index * 4;
  return `M ${p1.x} ${p1.y} Q ${cx} ${cy} ${p2.x} ${p2.y}`;
}

interface DiagramAreaProps {
  nodes: DiagramNodeData[];
  edges: DiagramEdge[];
  tag?: string;
  hint?: string;
}

export const DiagramArea = ({
  nodes: initialNodes,
  edges,
  tag = "// system.sketch",
  hint = "↻ drag the boxes — the tutor reflows the arrows",
}: DiagramAreaProps) => {
  const [nodes, setNodes] = useState<DiagramNodeData[]>(initialNodes);
  const areaRef = useRef<HTMLDivElement>(null);
  const [, forceRender] = useState(0);

  // Draw edges after mount (areaRef is null on first render) and on resize
  useEffect(() => {
    forceRender((v) => v + 1);
    const onResize = () => forceRender((v) => v + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const handleMove = useCallback((id: string, x: number, y: number) => {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, x, y } : n)));
    forceRender((v) => v + 1);
  }, []);

  const edgePaths = areaRef.current
    ? edges.map((edge, i) => ({
        ...edge,
        dashArray: edge.dashArray ?? "5 4",
        d: buildEdgePath(areaRef.current!, edge, i),
      }))
    : [];

  return (
    <div className={styles.area} ref={areaRef}>
      <div className={styles.tag}>{tag}</div>

      <svg className={styles.svg} aria-hidden="true">
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
          </marker>
        </defs>
        {edgePaths.map((edge) =>
          edge.d ? (
            <path
              key={`${edge.from}-${edge.to}`}
              d={edge.d}
              fill="none"
              stroke={edge.color ?? "var(--ink)"}
              strokeWidth="1.6"
              strokeDasharray={edge.dashArray ?? "5 4"}
              markerEnd="url(#arrow)"
              style={{ color: edge.color ?? "var(--ink)" }}
            />
          ) : null
        )}
      </svg>

      {nodes.map((node) => (
        <DiagramNode
          key={node.id}
          node={node}
          onMove={handleMove}
          containerRef={areaRef}
        />
      ))}

      <div className={styles.hint} aria-hidden="true">{hint}</div>
    </div>
  );
};
