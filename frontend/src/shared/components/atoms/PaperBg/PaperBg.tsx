import styles from "./PaperBg.module.css";

/** Fixed graph-paper background — place once at the root of each page. */
export const PaperBg = () => {
  return <div className={styles.bg} aria-hidden="true" />;
};
