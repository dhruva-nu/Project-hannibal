import type { Course } from "@/services/courses";
import { CourseCard } from "@/shared/components/molecules";
import type { CourseCardProps } from "@/shared/components/molecules/CourseCard/CourseCard";
import { ILLUSTRATIONS } from "../illustrations";
import styles from "../Courses.module.css";

type RegularCourse = Extract<CourseCardProps, { isGenUi?: false }>;

function toCardProps(course: Course): RegularCourse {
  return { ...course, illustration: ILLUSTRATIONS[course.code] ?? null };
}

interface FeaturedSectionProps {
  courses: Course[];
  openCourse: (course: Course, e: React.MouseEvent<HTMLElement>) => void;
}

export const FeaturedSection = ({ courses, openCourse }: FeaturedSectionProps) => (
  <section className={styles.section} aria-labelledby="section-featured">
    <div className={styles.sectionHead}>
      <div className={styles.sectionTitle}>
        <h2 id="section-featured">Featured builds</h2>
        <span className={styles.scribble}>— most started this week</span>
        <span className={styles.count}>06 / 24</span>
      </div>
      <div className={styles.sectionActions}>
        <button className={styles.actionBtn}>sort: popular ▾</button>
        <button className={[styles.actionBtn, styles.aiAction].join(" ")}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M12 3v18M3 12h18" />
          </svg>
          curate for me
        </button>
      </div>
    </div>
    <div className={styles.grid}>
      {courses.map((course) => (
        <CourseCard key={course.code} {...toCardProps(course)} onClick={(e) => openCourse(course, e)} />
      ))}
      <CourseCard
        isGenUi
        genUiLabel="Don't see what you need?"
        genUiHint={"tell the tutor — it'll generate\na custom course in this slot"}
      />
    </div>
  </section>
);
