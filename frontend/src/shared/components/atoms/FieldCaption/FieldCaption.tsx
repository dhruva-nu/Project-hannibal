import type { ReactNode } from "react";
import styles from "./FieldCaption.module.css";

export const FieldCaption = ({ children }: { children: ReactNode }) => <div className={styles.caption}>{children}</div>;
