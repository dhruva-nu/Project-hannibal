import type { MouseEvent, ReactNode } from "react";
import { classNames } from "@/shared/utils/classNames";
import styles from "./ToolButton.module.css";

interface ToolButtonProps {
  children: ReactNode;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  small?: boolean;
  danger?: boolean;
  active?: boolean;
  keepWidth?: boolean;
  disabled?: boolean;
  title?: string;
  "aria-label"?: string;
  "aria-pressed"?: boolean;
}

export const ToolButton = ({ children, onClick, small, danger, active, keepWidth, disabled, title, ...aria }: ToolButtonProps) => (
  <button
    type="button"
    className={classNames(styles.button, small && styles.small, danger && styles.danger, active && styles.active, keepWidth && styles.keepWidth)}
    onClick={onClick}
    disabled={disabled}
    title={title}
    {...aria}
  >
    {children}
  </button>
);
