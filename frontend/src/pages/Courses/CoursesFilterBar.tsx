import { FILTER_CATEGORIES } from "./courses.constants";
import styles from "./Courses.module.css";

interface CoursesFilterBarProps {
  activeFilter: string;
  onFilter: (cat: string) => void;
}

export const CoursesFilterBar = ({ activeFilter, onFilter }: CoursesFilterBarProps) => (
  <div className={styles.filterBar}>
    <span className={styles.filterLabel}>filter →</span>
    <button
      className={[styles.filterChip, activeFilter === "All" && styles.filterChipActive].filter(Boolean).join(" ")}
      onClick={() => onFilter("All")}
    >
      All <span className={styles.filterX}>·</span> 24
    </button>
    {FILTER_CATEGORIES.map((cat) => (
      <button
        key={cat}
        className={[styles.filterChip, activeFilter === cat && styles.filterChipActive].filter(Boolean).join(" ")}
        onClick={() => onFilter(cat)}
      >
        {cat}
      </button>
    ))}
  </div>
);
