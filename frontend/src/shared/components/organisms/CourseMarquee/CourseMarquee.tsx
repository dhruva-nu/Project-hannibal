import { Chip } from "@/shared/components/atoms";
import type { CourseChip } from "@/shared/types";
import styles from "./CourseMarquee.module.css";

const DEFAULT_COURSES: CourseChip[] = [
  { name: "Build an OTP system",          color: "oklch(0.66 0.20 28)" },
  { name: "Add 3rd-party login (OAuth)",  color: "oklch(0.62 0.13 220)" },
  { name: "Design a URL shortener",       color: "oklch(0.62 0.14 145)" },
  { name: "Rate limit an API",            color: "oklch(0.78 0.18 85)" },
  { name: "Build a job queue",            color: "oklch(0.55 0.18 280)" },
  { name: "Caching with Redis",           color: "oklch(0.66 0.20 28)" },
  { name: "Webhooks, retried correctly",  color: "oklch(0.62 0.13 220)" },
  { name: "Idempotent payments",          color: "oklch(0.62 0.14 145)" },
];

interface CourseMarqueeProps {
  courses?: CourseChip[];
  /** Duration in seconds */
  speed?: number;
}

export const CourseMarquee = ({ courses = DEFAULT_COURSES, speed = 32 }: CourseMarqueeProps) => {
  // Duplicate items so the seamless loop works
  const items = [...courses, ...courses];

  return (
    <div className={styles.marquee} aria-hidden="true">
      <div
        className={styles.track}
        style={{ "--marquee-duration": `${speed}s` } as React.CSSProperties}
      >
        {items.map((course, i) => (
          <Chip key={`${course.name}-${i}`} label={course.name} color={course.color} />
        ))}
      </div>
    </div>
  );
};
