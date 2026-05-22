import type { LearningPathStep } from "@/services/courses";
import { LearningPath } from "@/shared/components/organisms";
import styles from "../Courses.module.css";

interface ContinueSectionProps {
  pathSteps: LearningPathStep[];
}

export const ContinueSection = ({ pathSteps }: ContinueSectionProps) => (
  <section className={styles.section} aria-labelledby="section-continue">
    <div className={styles.sectionHead}>
      <div className={styles.sectionTitle}>
        <h2 id="section-continue">Continue your build</h2>
        <span className={styles.scribble}>— picking up where you left off</span>
        <span className={styles.count}>02 in progress</span>
      </div>
      <div className={styles.sectionActions}>
        <button className={styles.actionBtn}>view all</button>
      </div>
    </div>
    <LearningPath steps={pathSteps} stickyNote="tutor said: skip step 4 if you already know JWTs ✦" />
  </section>
);
