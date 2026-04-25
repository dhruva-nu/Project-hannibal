import styles from "./TypingIndicator.module.css";

export const TypingIndicator = () => {
  return (
    <span className={styles.typing} role="status" aria-label="AI is typing">
      <span className={styles.dot} />
      <span className={styles.dot} />
      <span className={styles.dot} />
    </span>
  );
};
