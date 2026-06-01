import type {
  BoardNodeData,
  BoardEdge,
  SelectedItem,
} from "@/shared/types/board";
import styles from "./DesignInspector.module.css";

interface DesignInspectorProps {
  nodes: Record<string, BoardNodeData>;
  edges: BoardEdge[];
  selected: SelectedItem | null;
  onUpdateLabel: (nodeId: string, label: string, moduleId?: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onDeleteModule: (nodeId: string, moduleId: string) => void;
  onDeleteEdge: (edgeId: string) => void;
}

export const DesignInspector = ({
  nodes,
  edges,
  selected,
  onUpdateLabel,
  onDeleteNode,
  onDeleteModule,
  onDeleteEdge,
}: DesignInspectorProps) => {
  if (!selected) {
    return (
      <aside className={styles.inspector} aria-label="Inspector">
        <h3 className={styles.heading}>Inspector</h3>
        <div className={styles.empty}>click a component, service, or arrow to edit it ✦</div>
      </aside>
    );
  }

  if (selected.kind === "edge") {
    const edge = edges.find(e => e.id === selected.id);
    if (!edge) return null;
    return (
      <aside className={styles.inspector} aria-label="Inspector">
        <h3 className={styles.heading}>Inspector</h3>
        <div className={styles.field}>
          <label className={styles.label}>connection</label>
          <div className={styles.pill}>
            {edge.from.nodeId}{edge.from.moduleId ? `/${edge.from.moduleId}` : ""} →{" "}
            {edge.to.nodeId}{edge.to.moduleId ? `/${edge.to.moduleId}` : ""}
          </div>
        </div>
        <button className={`${styles.btn} ${styles.danger}`} onClick={() => onDeleteEdge(edge.id)}>
          delete connection
        </button>
      </aside>
    );
  }

  const node = nodes[selected.id];
  if (!node) return null;

  if (selected.kind === "module" && selected.moduleId) {
    const mod = (node.modules ?? []).find(m => m.id === selected.moduleId);
    if (!mod) return null;
    return (
      <aside className={styles.inspector} aria-label="Inspector">
        <h3 className={styles.heading}>Inspector</h3>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="mod-label">module name</label>
          <input
            id="mod-label"
            className={styles.input}
            value={mod.label}
            onChange={e => onUpdateLabel(node.id, e.target.value, mod.id)}
          />
        </div>
        <div className={styles.pill}>inside service · {node.label}</div>
        <div style={{ height: 10 }} />
        <button
          className={`${styles.btn} ${styles.danger}`}
          onClick={() => onDeleteModule(node.id, mod.id)}
        >
          delete module
        </button>
      </aside>
    );
  }

  return (
    <aside className={styles.inspector} aria-label="Inspector">
      <h3 className={styles.heading}>Inspector</h3>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="node-label">label</label>
        <input
          id="node-label"
          className={styles.input}
          value={node.label}
          onChange={e => onUpdateLabel(node.id, e.target.value)}
        />
      </div>
      <div className={styles.field}>
        <label className={styles.label}>type</label>
        <div className={styles.pill}>{node.type}</div>
      </div>
      {node.type === "service" && (
        <div className={styles.field}>
          <label className={styles.label}>modules · {(node.modules ?? []).length}/5</label>
          <div className={styles.moduleList}>
            {(node.modules ?? []).map(m => (
              <div key={m.id} className={styles.pill}>{m.label}</div>
            ))}
          </div>
        </div>
      )}
      <button
        className={`${styles.btn} ${styles.danger}`}
        onClick={() => onDeleteNode(node.id)}
      >
        delete
      </button>
    </aside>
  );
};
