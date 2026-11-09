import styles from "./MethodBadge.module.css";

export const MethodBadge = ({ method }: { method: string }) => (
  <span className={styles.method} data-method={method}>
    {method}
  </span>
);
