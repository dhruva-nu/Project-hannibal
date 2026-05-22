import { useState } from "react";
import type { Lesson } from "@/services/courseDetail";
import styles from "./LessonsPanel.module.css";

interface LessonsPanelProps {
  lessons: Lesson[];
  completed: Set<string>;
  activeId: string | null;
  onSelect: (id: string) => void;
  isUnlocked: (idx: number) => boolean;
}

const CheckIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

export const LessonsPanel = ({ lessons, completed, activeId, onSelect, isUnlocked }: LessonsPanelProps) => {
  const [shaking, setShaking] = useState<string | null>(null);

  const handleClick = (id: string, idx: number) => {
    const lesson = lessons[idx];
    const unlocked = isUnlocked(idx);
    if (!unlocked && !completed.has(lesson.id)) {
      setShaking(id);
      setTimeout(() => setShaking(null), 360);
      return;
    }
    onSelect(id);
  };

  const completedCount = completed.size;
  const total = lessons.length;
  const pct = Math.round((completedCount / total) * 100);

  return (
    <aside className={styles.lessonsPanel}>
      <div className={styles.courseEyebrow}>
        <span className={styles.eyebrowDot} />
        course.001
      </div>
      <h1 className={styles.courseTitle}>
        Build an <span className={styles.marker}>OTP system</span> from scratch
      </h1>
      <div className={styles.courseMeta}>
        <span className={styles.lvl}>intermediate</span>
        <span className={styles.metaDot} />
        <span>{total} lessons</span>
        <span className={styles.metaDot} />
        <span>~2.5 hrs</span>
      </div>

      <div className={styles.lessonsHead}>
        <h3>Lessons</h3>
        <span className={styles.lessonsHeadScribble}>build · ship · learn</span>
      </div>

      <div className={styles.lessonsList}>
        {lessons.map((l, idx) => {
          const isComplete = completed.has(l.id);
          const isActive = activeId === l.id;
          const unlocked = isUnlocked(idx);
          const isLocked = !unlocked && !isComplete;
          const cls = [
            styles.lesson,
            isComplete ? styles.lessonComplete : "",
            isActive ? styles.lessonActive : "",
            isLocked ? styles.lessonLocked : "",
            shaking === l.id ? styles.lessonShaking : "",
          ].filter(Boolean).join(" ");

          return (
            <div key={l.id} className={cls} onClick={() => handleClick(l.id, idx)}>
              <div className={[styles.checkbox, isComplete ? styles.checkboxDone : ""].join(" ")}>
                <span className={[styles.checkboxIcon, isComplete ? styles.checkboxIconVisible : ""].join(" ")}>
                  <CheckIcon />
                </span>
              </div>
              <div className={styles.lessonNum}>LESSON {l.num}</div>
              <div className={styles.lessonTitle}>{l.title}</div>
              <div className={styles.lessonMeta}>
                <span className={[styles.lessonKind, l.kind === "theory" ? styles.lessonKindTheory : styles.lessonKindBuild].join(" ")}>
                  {l.kind}
                </span>
                <span>{l.meta || ""}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: "none" }} aria-hidden="true" data-progress={`${completedCount}/${total} ${pct}%`} />
    </aside>
  );
};
