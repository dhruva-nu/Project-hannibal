
import { BoardNode } from "@/shared/components/molecules/BoardNode/BoardNode";
import { ServiceBlock } from "@/shared/components/molecules/ServiceBlock/ServiceBlock";
import type { BoardNodeData, BoardEdge, PendingEdge, SelectedItem, PortPosition } from "@/pages/DesignBoard/boardTypes";
import { useEdgePaths } from "./useEdgePaths";
import styles from "./DesignCanvas.module.css";

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

export const DesignCanvas = ({ nodes, edges, pending, selected, innerRef, onNodeMove, onNodeSelect, onEdgeSelect, onCanvasClick, onPortPointerDown, onPortPointerUp, onDrop, onAddModule }: DesignCanvasProps) => {
  const { edgePaths, pendingPath } = useEdgePaths(nodes, edges, pending, innerRef);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const kind = e.dataTransfer.getData("kind");
    const label = e.dataTransfer.getData("label");
    if (!kind || !innerRef.current) return;
    const ir = innerRef.current.getBoundingClientRect();
    onDrop(kind, label, e.clientX - ir.left, e.clientY - ir.top);
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.helpPill}>drag from palette · hover a node to see ports · drag port to connect</div>
      <div className={styles.frame} aria-hidden="true" />
      <div className={styles.label} aria-hidden="true">System design</div>

      <div className={styles.canvas} onDragOver={e => e.preventDefault()} onDrop={handleDrop}
        onClick={e => { if (e.target === e.currentTarget) onCanvasClick(); }} aria-label="Design canvas">
        <div ref={innerRef} className={styles.inner} onClick={e => { if (e.target === e.currentTarget) onCanvasClick(); }}>
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
              <path key={ep.id} className={`${styles.edge} ${ep.isService ? styles.edgeService : ""}`} d={ep.d}
                markerEnd={ep.isService ? "url(#arrowDark)" : "url(#arrow)"}
                onClick={e => { e.stopPropagation(); onEdgeSelect(ep.id); }} aria-label="Connection edge" role="button" tabIndex={0} />
            ))}
            {pendingPath && <path className={styles.pendingEdge} d={pendingPath} />}
          </svg>

          {Object.values(nodes).map(n =>
            n.type === "component" ? (
              <BoardNode key={n.id} node={n} selected={selected?.kind === "node" && selected.id === n.id}
                onSelect={onNodeSelect} onMove={onNodeMove} onPortPointerDown={onPortPointerDown} onPortPointerUp={onPortPointerUp} />
            ) : (
              <ServiceBlock key={n.id} service={n}
                selected={selected?.kind === "service" && selected.id === n.id}
                selectedModuleId={selected?.kind === "module" && selected.id === n.id ? selected.moduleId : undefined}
                onSelect={onNodeSelect} onMove={onNodeMove} onPortPointerDown={onPortPointerDown}
                onPortPointerUp={onPortPointerUp} onAddModule={onAddModule} />
            )
          )}
        </div>
      </div>
    </div>
  );
};
