import type { Lesson } from "@/services/courseDetail";
import styles from "./TheoryPanel.module.css";

interface TheoryPanelProps {
  lesson: Lesson | null;
  shown: boolean;
  full?: boolean;
  alreadyDone: boolean;
  onClose: () => void;
  onDone: () => void;
}

const CloseIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);

export const TheoryPanel = ({ lesson, shown, full, alreadyDone, onClose, onDone }: TheoryPanelProps) => {
  const cls = [
    styles.theoryPanel,
    full ? styles.theoryPanelFull : (shown ? styles.theoryPanelShown : ""),
  ].filter(Boolean).join(" ");

  return (
    <div className={cls}>
      <button className={styles.theoryClose} onClick={onClose} aria-label="close">
        <CloseIcon />
      </button>
      <div className={styles.theoryTag}>{lesson?.theory?.tag ?? ""}</div>
      <h2 className={styles.theoryTitle}>{lesson?.title ?? ""}</h2>
      <div
        className={styles.theoryBody}
        dangerouslySetInnerHTML={{ __html: lesson?.theory?.body ?? "" }}
      />
      <div className={styles.theoryActions}>
        <span className={styles.boardTagRef}>
          no board changes — concept only
        </span>
        <button className={styles.doneBtn} onClick={onDone}>
          {alreadyDone ? "close" : "got it — mark as read →"}
        </button>
      </div>
    </div>
  );
};
