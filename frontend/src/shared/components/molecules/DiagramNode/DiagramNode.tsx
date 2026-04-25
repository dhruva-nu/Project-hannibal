import { useRef } from "react";
import type { DiagramNodeData } from "@/shared/types";
import styles from "./DiagramNode.module.css";

interface DiagramNodeProps {
  node: DiagramNodeData;
  onMove: (id: string, x: number, y: number) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

export const DiagramNode = ({ node, onMove, containerRef }: DiagramNodeProps) => {
  const startPos = useRef({ sx: 0, sy: 0, ox: 0, oy: 0 });
  const dragging = useRef(false);
  const elRef = useRef<HTMLDivElement>(null);

  const handlePointerDown = (ev: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    elRef.current?.setPointerCapture(ev.pointerId);
    startPos.current = {
      sx: ev.clientX,
      sy: ev.clientY,
      ox: node.x,
      oy: node.y,
    };
  };

  const handlePointerMove = (ev: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current || !containerRef.current || !elRef.current) return;
    const { sx, sy, ox, oy } = startPos.current;
    const ar = containerRef.current.getBoundingClientRect();
    const el = elRef.current;
    const nx = Math.max(4, Math.min(ar.width - el.offsetWidth - 4, ox + ev.clientX - sx));
    const ny = Math.max(4, Math.min(ar.height - el.offsetHeight - 4, oy + ev.clientY - sy));
    onMove(node.id, nx, ny);
  };

  const handlePointerUp = () => {
    dragging.current = false;
  };

  return (
    <div
      ref={elRef}
      className={styles.node}
      data-id={node.id}
      data-tag={node.tag}
      style={{ left: node.x, top: node.y }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      role="group"
      aria-label={`Diagram node: ${node.label}`}
    >
      <div className={styles.label}>
        {node.icon && <span className={styles.icon} aria-hidden="true">{node.icon}</span>}
        {node.label}
      </div>
      {node.sub && <div className={styles.sub}>{node.sub}</div>}
    </div>
  );
};
