import type { ReactNode } from "react";
import { classNames } from "@/shared/utils/classNames";
import styles from "./Pill.module.css";

interface PillProps {
  children: ReactNode;
  emphasis?: boolean;
}

export const Pill = ({ children, emphasis }: PillProps) => (
  <span className={classNames(styles.pill, emphasis && styles.emphasis)}>{children}</span>
);
