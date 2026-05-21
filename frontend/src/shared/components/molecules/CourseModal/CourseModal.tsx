import { createPortal } from "react-dom";
import styles from "./CourseModal.module.css";
import type { CourseCardProps } from "@/shared/components/molecules/CourseCard/CourseCard";
import { useModalFlip } from "./useModalFlip";
import { ModalCurriculum } from "./ModalCurriculum";

type RegularCourse = Extract<CourseCardProps, { isGenUi?: false }>;

interface CourseModalProps {
  course: RegularCourse;
  originRect: DOMRect;
  onClose: () => void;
}

const LEVEL_LABEL: Record<string, string> = { beginner: "beginner", intermediate: "intermediate", advanced: "advanced", "next-step": "next step" };
const LEVEL_CLASS: Record<string, string> = { beginner: styles.levelBeginner, intermediate: styles.levelIntermediate, advanced: styles.levelAdvanced, "next-step": styles.levelNextStep };

export const CourseModal = ({ course, originRect, onClose }: CourseModalProps) => {
  const { modalRef, backdropRef, handleClose } = useModalFlip(originRect, onClose);

  return createPortal(
    <div ref={backdropRef} className={styles.backdrop} onClick={handleClose} role="dialog" aria-modal="true" aria-label={course.title}>
      <div ref={modalRef} className={styles.modal} onClick={e => e.stopPropagation()}>

        <button className={styles.closeBtn} onClick={handleClose} aria-label="Close">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>

        <span className={styles.tag}>{course.code}</span>
        {course.ribbon && <span className={styles.ribbon}>{course.ribbon}</span>}

        <div className={styles.illus}>
          {course.pin && <span className={styles.pin}>{course.pin}</span>}
          {course.illustration}
        </div>

        <div className={styles.body}>
          <div className={styles.levelRow}>
            <span className={[styles.level, LEVEL_CLASS[course.level]].join(" ")}>{LEVEL_LABEL[course.level]}</span>
            <span className={styles.meta}>
              {course.lessons !== undefined && `${course.lessons} lessons`}
              {course.lessons !== undefined && course.duration && " · "}
              {course.duration}
              {course.buildCount !== undefined && ` · ${course.buildCount.toLocaleString()} builds`}
            </span>
          </div>

          <h2 className={styles.title}>{course.title}</h2>
          <p className={styles.desc}>{course.description}</p>

          {course.what && (
            <div className={styles.whatBox}>
              <span className={styles.whatLabel}>you ship →</span>
              <p className={styles.whatText}>{course.what}</p>
            </div>
          )}

          {course.learns && course.learns.length > 0 && (
            <div className={styles.section}>
              <span className={styles.sectionLabel}>// you&apos;ll learn</span>
              <ul className={styles.learnList}>{course.learns.map(item => <li key={item}>{item}</li>)}</ul>
            </div>
          )}

          {course.prerequisites && course.prerequisites.length > 0 && (
            <div className={styles.prereqRow}>
              <span className={styles.prereqLabel}>before you start:</span>
              <span className={styles.prereqItems}>{course.prerequisites.join(" · ")}</span>
            </div>
          )}

          {course.curriculum && course.curriculum.length > 0 && (
            <ModalCurriculum lessons={course.curriculum} />
          )}

          {course.stack && course.stack.length > 0 && (
            <div className={styles.stack}>{course.stack.map(tech => <span key={tech}>{tech}</span>)}</div>
          )}

          <div className={styles.footer}>
            {course.id !== undefined
              ? <a className={styles.startBtn} href={`/courses/${course.id}`}>start build →</a>
              : <button className={styles.startBtn} disabled>start build →</button>}
            <button className={styles.saveBtn}>save for later</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};
