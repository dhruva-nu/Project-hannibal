import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./CourseModal.module.css";
import type { CourseCardProps } from "@/shared/components/molecules/CourseCard/CourseCard";

type RegularCourse = Extract<CourseCardProps, { isGenUi?: false }>;

interface CourseModalProps {
  course: RegularCourse;
  originRect: DOMRect;
  onClose: () => void;
}

const LEVEL_LABEL: Record<string, string> = {
  beginner: "beginner",
  intermediate: "intermediate",
  advanced: "advanced",
  "next-step": "next step",
};

const LEVEL_CLASS: Record<string, string> = {
  beginner: styles.levelBeginner,
  intermediate: styles.levelIntermediate,
  advanced: styles.levelAdvanced,
  "next-step": styles.levelNextStep,
};

const LESSON_TYPE_LABEL: Record<string, string> = {
  concept: "read",
  project: "build",
  challenge: "break",
};

const LESSON_TYPE_CLASS: Record<string, string> = {
  concept: styles.lessonConcept,
  project: styles.lessonProject,
  challenge: styles.lessonChallenge,
};

const OPEN_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
const CLOSE_EASING = "cubic-bezier(0.55, 0, 0.85, 0.5)";

export const CourseModal = ({ course, originRect, onClose }: CourseModalProps) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const closingRef = useRef(false);
  const [curriculumOpen, setCurriculumOpen] = useState(false);

  // FLIP open: snap modal to card position then spring to center
  useLayoutEffect(() => {
    const modal = modalRef.current;
    if (!modal) return;

    const mr = modal.getBoundingClientRect();
    const dx = (originRect.left + originRect.width / 2) - (mr.left + mr.width / 2);
    const dy = (originRect.top + originRect.height / 2) - (mr.top + mr.height / 2);
    const sx = originRect.width / mr.width;
    const sy = originRect.height / mr.height;

    modal.style.transition = "none";
    modal.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
    modal.style.opacity = "0.6";

    // Double rAF ensures the browser has painted the initial state
    requestAnimationFrame(() => requestAnimationFrame(() => {
      modal.style.transition = `transform 0.46s ${OPEN_EASING}, opacity 0.24s ease`;
      modal.style.transform = "";
      modal.style.opacity = "";
    }));
  }, [originRect]);

  const handleClose = () => {
    if (closingRef.current) return;
    closingRef.current = true;

    const modal = modalRef.current;
    const backdrop = backdropRef.current;
    if (!modal) { onClose(); return; }

    const mr = modal.getBoundingClientRect();
    const dx = (originRect.left + originRect.width / 2) - (mr.left + mr.width / 2);
    const dy = (originRect.top + originRect.height / 2) - (mr.top + mr.height / 2);
    const sx = originRect.width / mr.width;
    const sy = originRect.height / mr.height;

    modal.style.transition = `transform 0.36s ${CLOSE_EASING}, opacity 0.28s ease`;
    modal.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
    modal.style.opacity = "0";

    if (backdrop) {
      backdrop.style.transition = "opacity 0.34s ease";
      backdrop.style.opacity = "0";
    }

    setTimeout(onClose, 360);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") handleClose(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, []);

  return createPortal(
    <div ref={backdropRef} className={styles.backdrop} onClick={handleClose} role="dialog" aria-modal="true" aria-label={course.title}>
      <div ref={modalRef} className={styles.modal} onClick={(e) => e.stopPropagation()}>

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
            <span className={[styles.level, LEVEL_CLASS[course.level]].join(" ")}>
              {LEVEL_LABEL[course.level]}
            </span>
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
              <ul className={styles.learnList}>
                {course.learns.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          {course.prerequisites && course.prerequisites.length > 0 && (
            <div className={styles.prereqRow}>
              <span className={styles.prereqLabel}>before you start:</span>
              <span className={styles.prereqItems}>{course.prerequisites.join(" · ")}</span>
            </div>
          )}

          {course.curriculum && course.curriculum.length > 0 && (
            <div className={styles.section}>
              <button
                className={styles.curriculumToggle}
                onClick={() => setCurriculumOpen((o) => !o)}
                aria-expanded={curriculumOpen}
              >
                <span className={styles.sectionLabel}>// curriculum</span>
                <span className={styles.curriculumMeta}>
                  {course.curriculum.length} lessons
                  <svg
                    className={[styles.chevron, curriculumOpen && styles.chevronOpen].filter(Boolean).join(" ")}
                    width="12" height="12" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </span>
              </button>

              <div className={[styles.curriculumBody, curriculumOpen && styles.curriculumBodyOpen].filter(Boolean).join(" ")}>
                <ol className={styles.curriculumList}>
                  {course.curriculum.map((lesson, i) => (
                    <li key={i} className={styles.lesson}>
                      <span className={styles.lessonNum}>{String(i + 1).padStart(2, "0")}</span>
                      <span className={styles.lessonTitle}>{lesson.title}</span>
                      <span className={[styles.lessonType, LESSON_TYPE_CLASS[lesson.type]].join(" ")}>
                        {LESSON_TYPE_LABEL[lesson.type]}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}

          {course.stack && course.stack.length > 0 && (
            <div className={styles.stack}>
              {course.stack.map((tech) => (
                <span key={tech}>{tech}</span>
              ))}
            </div>
          )}

          <div className={styles.footer}>
            {course.id !== undefined
              ? <a className={styles.startBtn} href={`/courses/${course.id}`}>start build →</a>
              : <button className={styles.startBtn} disabled>start build →</button>
            }
            <button className={styles.saveBtn}>save for later</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};
