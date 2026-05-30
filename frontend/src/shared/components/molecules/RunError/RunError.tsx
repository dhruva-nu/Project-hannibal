import { useState } from "react";
import { createPortal } from "react-dom";
import styles from "./RunError.module.css";

interface RunErrorProps {
  message: string;
}

export const RunError = ({ message }: RunErrorProps) => {
  const [open, setOpen] = useState(false);

  return (
    <div className={styles.wrap}>
      <button className={styles.badge} onClick={() => setOpen(true)}>
        <span className={styles.badgeIcon}>✕</span>
        <span className={styles.badgeLabel}>runtime error</span>
        <span className={styles.badgeHint}>click to expand</span>
      </button>

      {open && createPortal(
        <div className={styles.overlay} onClick={() => setOpen(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHead}>
              <span className={styles.modalTitle}>// runtime error</span>
              <button className={styles.modalClose} onClick={() => setOpen(false)}>×</button>
            </div>
            <pre className={styles.trace}>{message}</pre>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
};
