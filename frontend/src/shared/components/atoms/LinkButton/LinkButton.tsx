import type { ReactNode } from "react";
import styles from "./LinkButton.module.css";

interface LinkButtonProps {
  children: ReactNode;
  onClick: () => void;
}

export const LinkButton = ({ children, onClick }: LinkButtonProps) => (
  <button type="button" className={styles.linkButton} onClick={onClick}>
    {children}
  </button>
);
