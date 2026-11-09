import type { ServiceNode } from "../../engine";
import { MethodBadge, ToolButton } from "../../ui/Controls";
import styles from "./popup.module.css";

interface Props {
  node: ServiceNode;
  currentId: string | undefined;
  onFocus: (endpointId: string) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}

export const EndpointPicker = ({ node, currentId, onFocus, onAdd, onRemove }: Props) => (
  <div className={styles.endpointList}>
    <ToolButton small onClick={onAdd}>
      Add endpoint
    </ToolButton>
    {node.cfg.endpoints.map((endpoint, index) => (
      <div key={endpoint.id} className={styles.endpointItem} aria-current={endpoint.id === currentId}>
        <button
          type="button"
          className={styles.endpointSelect}
          onClick={() => onFocus(endpoint.id)}
        >
          <MethodBadge method={endpoint.method} />
          <span className={styles.path}>{endpoint.path}</span>
        </button>
        <ToolButton small fixed onClick={() => onRemove(index)} aria-label={`Remove ${endpoint.method} ${endpoint.path}`}>
          ✕
        </ToolButton>
      </div>
    ))}
  </div>
);
