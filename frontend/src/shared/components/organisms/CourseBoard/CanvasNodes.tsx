import { useRef } from "react";
import type { PlacedNode } from "@/services/nodes";
import styles from "./CourseBoard.module.css";

interface CanvasNodesProps {
  placedNodes: PlacedNode[];
  nodePositions: Record<string, { x: number; y: number }>;
  onMove: (id: string, x: number, y: number) => void;
}

export function CanvasNodes({ placedNodes, nodePositions, onMove }: CanvasNodesProps) {
  const dragRef = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number } | null>(null);

  const pos = (n: PlacedNode) =>
    nodePositions[n.id] ?? { x: n.default_x ?? 0, y: n.default_y ?? 0 };

  const startDrag = (id: string, origX: number, origY: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { id, startX: e.clientX, startY: e.clientY, origX, origY };

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      onMove(
        dragRef.current.id,
        dragRef.current.origX + ev.clientX - dragRef.current.startX,
        dragRef.current.origY + ev.clientY - dragRef.current.startY,
      );
    };

    const onMouseUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  const KEY_OFFSETS: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  };

  const nudgeWithKeyboard = (id: string, x: number, y: number) => (e: React.KeyboardEvent) => {
    const offset = KEY_OFFSETS[e.key];
    if (!offset) return;
    e.preventDefault();
    const step = e.shiftKey ? 1 : 10;
    onMove(id, x + offset[0] * step, y + offset[1] * step);
  };

  const services = placedNodes.filter(n => n.type === "service");
  const components = placedNodes.filter(n => n.type === "component");
  const modules = placedNodes.filter(n => n.type === "module");

  return (
    <>
      {services.map(n => {
        const { x, y } = pos(n);
        return (
          <div
            key={n.id}
            className={[styles.service, styles.serviceShown].join(" ")}
            style={{
              left: `${x}px`,
              top: `${y}px`,
              width: n.default_w != null ? `${n.default_w}px` : undefined,
              cursor: "grab",
            }}
            data-nodeid={n.id}
            role="button"
            tabIndex={0}
            aria-label={`${n.label} — drag or use arrow keys to move`}
            onMouseDown={startDrag(n.id, x, y)}
            onKeyDown={nudgeWithKeyboard(n.id, x, y)}
          >
            <div className={styles.serviceModules}>
              {modules
                .filter(m => m.parent_id === n.id)
                .map(m => (
                  <div
                    key={m.id}
                    className={[styles.module, styles.moduleShown].join(" ")}
                    data-modid={`${n.id}:${m.id}`}
                  >
                    {m.label}
                  </div>
                ))}
            </div>
            <div className={styles.serviceLabel}>{n.label}</div>
          </div>
        );
      })}
      {components.map(n => {
        const { x, y } = pos(n);
        return (
          <div
            key={n.id}
            className={[styles.node, styles.nodeShown].join(" ")}
            style={{ left: `${x}px`, top: `${y}px`, cursor: "grab" }}
            data-nodeid={n.id}
            role="button"
            tabIndex={0}
            aria-label={`${n.label} — drag or use arrow keys to move`}
            onMouseDown={startDrag(n.id, x, y)}
            onKeyDown={nudgeWithKeyboard(n.id, x, y)}
          >
            {n.label}
          </div>
        );
      })}
    </>
  );
}
