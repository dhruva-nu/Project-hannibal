import styles from "./Spinner.module.css";

interface SpinnerProps {
  label?: string;
}

export const Spinner = ({ label = "Loading…" }: SpinnerProps) => (
  <div className={styles.wrap} role="status" aria-live="polite">
    <span className={styles.ring} aria-hidden="true" />
    <span className={styles.label}>{label}</span>
  </div>
);
