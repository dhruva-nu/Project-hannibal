import { useEffect, useRef, type ReactNode } from "react";
import { ToolButton } from "../../ui/Controls";
import styles from "./overlays.module.css";

interface ModalProps {
  title: string;
  wide?: boolean;
  onClose: () => void;
  children: ReactNode;
}

export const Modal = ({ title, wide, onClose, children }: ModalProps) => {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div
      className={styles.overlay}
      data-testid="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-label={title}
        className={[styles.dialog, wide && styles.dialogWide].filter(Boolean).join(" ")}
      >
        <div className={styles.dialogHeader}>
          <strong>{title}</strong>
          <ToolButton small onClick={onClose}>
            Close
          </ToolButton>
        </div>
        <div className={styles.dialogBody}>{children}</div>
      </div>
    </div>
  );
};
