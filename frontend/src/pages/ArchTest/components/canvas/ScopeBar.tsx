import { LAYERS, type LayerId } from "../../engine";
import { ToolButton } from "../../ui/Controls";
import styles from "./canvas.module.css";

interface ScopeBarProps {
  scope: LayerId;
  onFit: () => void;
  onClose: () => void;
}

export const ScopeBar = ({ scope, onFit, onClose }: ScopeBarProps) => {
  const layer = LAYERS.find((l) => l.id === scope);
  return (
    <div className={styles.scopeBar} data-scopebar="true">
      <strong className={styles.scopeTitle}>{layer?.label}</strong>
      <span className={styles.muted}>Drag to pan, Ctrl/Cmd + scroll to zoom. Double-click a box for details.</span>
      <span className={styles.spacer} />
      <ToolButton small onClick={onFit}>
        Fit
      </ToolButton>
      <ToolButton small onClick={onClose}>
        Back to overview
      </ToolButton>
    </div>
  );
};
