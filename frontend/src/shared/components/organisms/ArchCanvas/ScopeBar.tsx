import { LAYERS, type LayerId } from "@/pages/ArchTest/engine";
import { ToolButton } from "@/shared/components/atoms";
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
      <nav className={styles.crumbs} aria-label="Breadcrumb">
        <button type="button" className={styles.crumbLink} onClick={onClose}>
          Overview
        </button>
        <span className={styles.crumbSep} aria-hidden="true">
          ›
        </span>
        <strong className={styles.scopeTitle} data-cat={scope}>
          <i className={styles.dot} />
          {layer?.label}
        </strong>
      </nav>
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
