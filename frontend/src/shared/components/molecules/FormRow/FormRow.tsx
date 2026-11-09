import type { ReactNode } from "react";
import styles from "./FormRow.module.css";

export const FormRow = ({ children }: { children: ReactNode }) => <div className={styles.row}>{children}</div>;

export const FixedCell = ({ children }: { children: ReactNode }) => <span className={styles.fixedCell}>{children}</span>;
