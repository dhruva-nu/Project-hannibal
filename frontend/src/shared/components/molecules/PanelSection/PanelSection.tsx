import type { ReactNode } from "react";
import styles from "./PanelSection.module.css";

interface PanelSectionProps {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}

export const PanelSection = ({ title, action, children }: PanelSectionProps) => (
  <section className={styles.section}>
    <h4 className={styles.title}>
      <span>{title}</span>
      {action}
    </h4>
    {children}
  </section>
);
