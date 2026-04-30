import styles from "./LearningPath.module.css";

export type PathStepStatus = "complete" | "current" | "upcoming";

export interface PathStep {
  num: string;
  title: string;
  meta: string;
  status?: PathStepStatus;
}

interface LearningPathProps {
  steps: PathStep[];
  stickyNote?: string;
}

export const LearningPath = ({ steps, stickyNote }: LearningPathProps) => {
  return (
    <div className={styles.path}>
      {stickyNote && (
        <div className={styles.stickyNote} aria-hidden="true">
          {stickyNote}
        </div>
      )}
      <div className={styles.lane}>
        {steps.map((step) => (
          <div
            key={step.num}
            className={[
              styles.step,
              step.status === "complete" && styles.complete,
              step.status === "current" && styles.current,
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <div className={styles.num}>{step.num}</div>
            <div className={styles.title}>{step.title}</div>
            <div className={styles.meta}>{step.meta}</div>
          </div>
        ))}
      </div>
    </div>
  );
};
