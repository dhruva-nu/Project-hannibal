import type { ReactNode } from "react";
import styles from "./Collapsible.module.css";

interface CollapsibleProps {
  summary: ReactNode;
  open: boolean;
  onToggle: (open: boolean) => void;
  children: ReactNode;
}

export const Collapsible = ({ summary, open, onToggle, children }: CollapsibleProps) => (
  <details className={styles.details} open={open} onToggle={(event) => onToggle(event.currentTarget.open)}>
    <summary>{summary}</summary>
    <div>{children}</div>
  </details>
);
