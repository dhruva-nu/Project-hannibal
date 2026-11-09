import { ToolButton } from "@/shared/components/atoms/ToolButton/ToolButton";
import { Modal } from "@/shared/components/molecules/Modal/Modal";
import styles from "./ConfirmDialog.module.css";

interface ConfirmDialogProps {
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}

export const ConfirmDialog = ({ message, confirmLabel, onConfirm, onClose }: ConfirmDialogProps) => (
  <Modal title="Please confirm" onClose={onClose}>
    <p className={styles.message}>{message}</p>
    <div className={styles.actions}>
      <ToolButton onClick={onClose}>Cancel</ToolButton>
      <ToolButton
        danger
        onClick={() => {
          onClose();
          onConfirm();
        }}
      >
        {confirmLabel}
      </ToolButton>
    </div>
  </Modal>
);
