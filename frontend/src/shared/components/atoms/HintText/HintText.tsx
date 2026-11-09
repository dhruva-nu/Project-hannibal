import type { ReactNode } from "react";
import styles from "./HintText.module.css";

export const HintText = ({ children }: { children: ReactNode }) => <div className={styles.hint}>{children}</div>;
