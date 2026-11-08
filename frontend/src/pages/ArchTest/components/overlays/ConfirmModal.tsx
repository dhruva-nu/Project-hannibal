import type { ConfirmRequest } from "../../state/archApi";
import { ToolButton } from "../../ui/Controls";
import { Modal } from "./Modal";
import styles from "./overlays.module.css";

interface ConfirmModalProps {
  request: ConfirmRequest;
  onClose: () => void;
}

export const ConfirmModal = ({ request, onClose }: ConfirmModalProps) => (
  <Modal title="Please confirm" onClose={onClose}>
    <p className={styles.flush}>{request.message}</p>
    <div className={styles.actions}>
      <ToolButton onClick={onClose}>Cancel</ToolButton>
      <ToolButton
        danger
        onClick={() => {
          onClose();
          request.onConfirm();
        }}
      >
        {request.confirmLabel}
      </ToolButton>
    </div>
  </Modal>
);
