import type { Notice } from "../state/archApi";
import { ToolButton } from "../ui/Controls";
import styles from "./toast.module.css";

interface ToastProps {
  notice: Notice | null;
  onDismiss: () => void;
}

export const Toast = ({ notice, onDismiss }: ToastProps) => {
  if (!notice) return null;
  return (
    <div className={styles.toast} role="status">
      <span>{notice.message}</span>
      {notice.actionLabel && notice.onAction && (
        <ToolButton
          small
          onClick={() => {
            notice.onAction?.();
            onDismiss();
          }}
        >
          {notice.actionLabel}
        </ToolButton>
      )}
    </div>
  );
};
