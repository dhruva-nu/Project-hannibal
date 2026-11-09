import type { ReactNode } from "react";
import styles from "./CodeBlock.module.css";

export const CodeBlock = ({ children }: { children: ReactNode }) => <pre className={styles.code}>{children}</pre>;
