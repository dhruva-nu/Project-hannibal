import { useRef } from "react";
import { PortDot } from "@/shared/components/atoms/PortDot/PortDot";
import type { BoardNodeData, PortPosition, SelectedItem } from "@/shared/types/board";
import styles from "./ServiceBlock.module.css";

interface ServiceBlockProps {
  service: BoardNodeData;
  selected: boolean;
  selectedModuleId?: string;
  onSelect: (item: SelectedItem) => void;
  onMove: (id: string, x: number, y: number) => void;
  onPortPointerDown: (e: React.PointerEvent, nodeId: string, moduleId: string | undefined, port: PortPosition) => void;
  onPortPointerUp: (nodeId: string, moduleId: string | undefined, port: PortPosition) => void;
  onAddModule: (serviceId: string, label: string) => void;
}

const SERVICE_PORTS: PortPosition[] = ["l", "r", "t", "b"];
const MODULE_PORTS: PortPosition[] = ["l", "r"];

export const ServiceBlock = ({
  service,
  selected,
  selectedModuleId,
  onSelect,
  onMove,
  onPortPointerDown,
  onPortPointerUp,
  onAddModule,
}: ServiceBlockProps) => {
  const elRef = useRef<HTMLDivElement>(null);
  const drag = useRef({ active: false, sx: 0, sy: 0, ox: 0, oy: 0 });

  const handlePointerDown = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    if (target.dataset.portDot !== undefined || target.classList.contains(styles.moduleRow) || target.classList.contains(styles.addBtn)) return;
    e.stopPropagation();
    onSelect({ kind: "service", id: service.id });
    drag.current = { active: true, sx: e.clientX, sy: e.clientY, ox: service.x, oy: service.y };
    elRef.current?.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!drag.current.active) return;
    const { sx, sy, ox, oy } = drag.current;
    onMove(service.id, Math.max(0, ox + e.clientX - sx), Math.max(0, oy + e.clientY - sy));
  };

  const handlePointerUp = () => {
    drag.current.active = false;
  };

  const handleAddModule = (e: React.MouseEvent) => {
    e.stopPropagation();
    const modules = service.modules ?? [];
    if (modules.length >= 5) return;
    const label = prompt("Module name", "New Module");
    if (label) onAddModule(service.id, label);
  };

  const modules = service.modules ?? [];
  const isFull = modules.length >= 5;

  return (
    <div
      ref={elRef}
      className={`${styles.service} ${selected ? styles.selected : ""}`}
      style={{ left: service.x, top: service.y, width: service.w ?? 220 }}
      data-service-id={service.id}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      role="group"
      aria-label={`Service: ${service.label}`}
    >
      <div className={styles.modules}>
        {modules.map(m => (
          <div
            key={m.id}
            className={`${styles.moduleRow} ${selectedModuleId === m.id ? styles.moduleSelected : ""}`}
            data-module-id={m.id}
            onPointerDown={e => {
              if ((e.target as HTMLElement).dataset.portDot !== undefined) return;
              e.stopPropagation();
              onSelect({ kind: "module", id: service.id, moduleId: m.id });
            }}
            role="button"
            aria-label={`Module: ${m.label}`}
            aria-pressed={selectedModuleId === m.id}
          >
            {m.label}
            {MODULE_PORTS.map(p => (
              <PortDot
                key={p}
                position={p}
                onPointerDown={e => { e.stopPropagation(); onPortPointerDown(e, service.id, m.id, p); }}
                onPointerUp={e => { e.stopPropagation(); onPortPointerUp(service.id, m.id, p); }}
              />
            ))}
          </div>
        ))}
        <button
          className={`${styles.addBtn} ${isFull ? styles.full : ""}`}
          onPointerDown={e => e.stopPropagation()}
          onClick={handleAddModule}
          disabled={isFull}
          aria-label={isFull ? "Maximum 5 modules reached" : "Add module"}
        >
          {isFull ? "max 5 modules" : "+ add module"}
        </button>
      </div>

      {SERVICE_PORTS.map(p => (
        <PortDot
          key={p}
          position={p}
          onPointerDown={e => { e.stopPropagation(); onPortPointerDown(e, service.id, undefined, p); }}
          onPointerUp={e => { e.stopPropagation(); onPortPointerUp(service.id, undefined, p); }}
        />
      ))}

      <div className={styles.label}>{service.label}</div>
    </div>
  );
};
