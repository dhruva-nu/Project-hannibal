import type { ReactNode } from "react";
import styles from "./MutedText.module.css";

export const MutedText = ({ children }: { children: ReactNode }) => <span className={styles.muted}>{children}</span>;
