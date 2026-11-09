import type { ReactNode } from "react";
import styles from "./DataTable.module.css";

export const DataTable = ({ children }: { children: ReactNode }) => <table className={styles.table}>{children}</table>;
