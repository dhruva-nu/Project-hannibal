import { useEffect, useRef, type ReactNode } from "react";
import { ToolButton } from "@/shared/components/atoms/ToolButton/ToolButton";
import { classNames } from "@/shared/utils/classNames";
import styles from "./Modal.module.css";

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
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-label={title} className={classNames(styles.dialog, wide && styles.wide)}>
        <div className={styles.header}>
          <strong>{title}</strong>
          <ToolButton small onClick={onClose}>
            Close
          </ToolButton>
        </div>
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  );
};
