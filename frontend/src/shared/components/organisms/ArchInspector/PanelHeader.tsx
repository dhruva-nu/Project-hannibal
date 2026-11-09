import type { ReactNode } from "react";
import { NO_SELECTION, useArch } from "@/pages/ArchTest/state/archApi";
import { ToolButton } from "@/shared/components/atoms";
import styles from "./panel.module.css";

interface PanelHeaderProps {
  title: string;
  subtitle: string;
  actions?: ReactNode;
}

export const PanelHeader = ({ title, subtitle, actions }: PanelHeaderProps) => {
  const { select } = useArch();
  return (
    <div className={styles.header}>
      <div className={styles.headerText}>
        <div className={styles.title}>{title}</div>
        <div className={styles.subtitle}>{subtitle}</div>
      </div>
      <div className={styles.actions}>{actions}</div>
      <ToolButton small aria-label="Close panel" onClick={() => select(NO_SELECTION)}>
        ✕
      </ToolButton>
    </div>
  );
};
