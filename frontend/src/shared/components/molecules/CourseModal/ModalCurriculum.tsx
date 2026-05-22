import { useState } from "react";
import styles from "./CourseModal.module.css";

interface CurriculumLesson {
  title: string;
  type: "concept" | "project" | "challenge";
}

interface ModalCurriculumProps {
  lessons: CurriculumLesson[];
}

const TYPE_LABEL: Record<string, string> = { concept: "read", project: "build", challenge: "break" };
const TYPE_CLASS: Record<string, string> = {
  concept: styles.lessonConcept,
  project: styles.lessonProject,
  challenge: styles.lessonChallenge,
};

export const ModalCurriculum = ({ lessons }: ModalCurriculumProps) => {
  const [open, setOpen] = useState(false);

  return (
    <div className={styles.section}>
      <button className={styles.curriculumToggle} onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className={styles.sectionLabel}>// curriculum</span>
        <span className={styles.curriculumMeta}>
          {lessons.length} lessons
          <svg
            className={[styles.chevron, open && styles.chevronOpen].filter(Boolean).join(" ")}
            width="12" height="12" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </span>
      </button>
      <div className={[styles.curriculumBody, open && styles.curriculumBodyOpen].filter(Boolean).join(" ")}>
        <ol className={styles.curriculumList}>
          {lessons.map((lesson, i) => (
            <li key={i} className={styles.lesson}>
              <span className={styles.lessonNum}>{String(i + 1).padStart(2, "0")}</span>
              <span className={styles.lessonTitle}>{lesson.title}</span>
              <span className={[styles.lessonType, TYPE_CLASS[lesson.type]].join(" ")}>
                {TYPE_LABEL[lesson.type]}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
};
