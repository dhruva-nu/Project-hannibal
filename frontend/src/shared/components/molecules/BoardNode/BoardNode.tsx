import { useRef } from "react";
import { PortDot } from "@/shared/components/atoms/PortDot/PortDot";
import type { BoardNodeData, PortPosition, SelectedItem } from "@/shared/types/board";
import styles from "./BoardNode.module.css";

interface BoardNodeProps {
  node: BoardNodeData;
  selected: boolean;
  onSelect: (item: SelectedItem) => void;
  onMove: (id: string, x: number, y: number) => void;
  onPortPointerDown: (e: React.PointerEvent, nodeId: string, moduleId: undefined, port: PortPosition) => void;
  onPortPointerUp: (nodeId: string, moduleId: undefined, port: PortPosition) => void;
}

const PORTS: PortPosition[] = ["l", "r", "t", "b"];

export const BoardNode = ({
  node,
  selected,
  onSelect,
  onMove,
  onPortPointerDown,
  onPortPointerUp,
}: BoardNodeProps) => {
  const elRef = useRef<HTMLDivElement>(null);
  const drag = useRef({ active: false, sx: 0, sy: 0, ox: 0, oy: 0 });

  const handlePointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).dataset.portDot !== undefined) return;
    e.stopPropagation();
    onSelect({ kind: "node", id: node.id });
    drag.current = { active: true, sx: e.clientX, sy: e.clientY, ox: node.x, oy: node.y };
    elRef.current?.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!drag.current.active) return;
    const { sx, sy, ox, oy } = drag.current;
    onMove(node.id, Math.max(0, ox + e.clientX - sx), Math.max(0, oy + e.clientY - sy));
  };

  const handlePointerUp = () => {
    drag.current.active = false;
  };

  return (
    <div
      ref={elRef}
      className={`${styles.node} ${selected ? styles.selected : ""}`}
      style={{ left: node.x, top: node.y }}
      data-node-id={node.id}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      role="button"
      aria-label={`Node: ${node.label}`}
      aria-pressed={selected}
    >
      {node.label}
      {PORTS.map(p => (
        <PortDot
          key={p}
          position={p}
          onPointerDown={e => onPortPointerDown(e, node.id, undefined, p)}
          onPointerUp={e => { e.stopPropagation(); onPortPointerUp(node.id, undefined, p); }}
        />
      ))}
    </div>
  );
};
