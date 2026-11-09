import { ToolButton } from "@/shared/components/atoms/ToolButton/ToolButton";
import styles from "./Toast.module.css";

interface ToastProps {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: () => void;
}

export const Toast = ({ message, actionLabel, onAction, onDismiss }: ToastProps) => (
  <div className={styles.toast} role="status">
    <span>{message}</span>
    {actionLabel && onAction && (
      <ToolButton
        small
        onClick={() => {
          onAction();
          onDismiss();
        }}
      >
        {actionLabel}
      </ToolButton>
    )}
  </div>
);
