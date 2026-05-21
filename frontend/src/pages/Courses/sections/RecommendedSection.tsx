import type { Course } from "@/services/courses";
import { CourseCard } from "@/shared/components/molecules";
import type { CourseCardProps } from "@/shared/components/molecules/CourseCard/CourseCard";
import { ILLUSTRATIONS } from "../illustrations";
import styles from "../Courses.module.css";

type RegularCourse = Extract<CourseCardProps, { isGenUi?: false }>;

function toCardProps(course: Course): RegularCourse {
  return { ...course, illustration: ILLUSTRATIONS[course.code] ?? null };
}

interface RecommendedSectionProps {
  courses: Course[];
  openCourse: (course: Course, e: React.MouseEvent<HTMLElement>) => void;
}

export const RecommendedSection = ({ courses, openCourse }: RecommendedSectionProps) => (
  <section className={styles.section} aria-labelledby="section-recommended">
    <div className={styles.genuiBanner}>
      <div className={styles.aiIcon}>PH</div>
      <div className={styles.bannerText}>
        <strong>Tutor synthesized this section just now</strong> — based on your last build (OTP) and what&apos;s trending in your team. Tap any card to refine.
      </div>
      <div className={styles.bannerMeta}>
        <span className={styles.liveDot} aria-hidden="true" />
        <span>fresh · 12s ago</span>
      </div>
    </div>

    <div className={styles.sectionHead}>
      <div className={styles.sectionTitle}>
        <h2 id="section-recommended">What to learn next</h2>
        <span className={styles.scribble}>— recommended for you</span>
        <span className={styles.count}>04 picks</span>
      </div>
      <div className={styles.sectionActions}>
        <button className={[styles.actionBtn, styles.aiAction].join(" ")}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M3 12a9 9 0 1 0 9-9M3 3v6h6" />
          </svg>
          regenerate
        </button>
        <button className={styles.actionBtn}>pin section</button>
      </div>
    </div>

    <div className={styles.grid}>
      {courses.map((course) => (
        <CourseCard key={course.code} {...toCardProps(course)} onClick={(e) => openCourse(course, e)} />
      ))}
      <CourseCard
        isGenUi
        genUiSymbol="⌘ K"
        genUiLabel="Generate a path for what you're building"
        genUiHint={"\"add billing\", \"make it real-time\",\n\"design a feed\"…"}
      />
    </div>
  </section>
);
