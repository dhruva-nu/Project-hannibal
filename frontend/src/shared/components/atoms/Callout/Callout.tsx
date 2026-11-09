import type { ReactNode } from "react";
import styles from "./Callout.module.css";

interface CalloutProps {
  tone: "warning" | "success";
  children: ReactNode;
}

export const Callout = ({ tone, children }: CalloutProps) => (
  <div className={styles.callout} data-tone={tone}>
    {children}
  </div>
);
