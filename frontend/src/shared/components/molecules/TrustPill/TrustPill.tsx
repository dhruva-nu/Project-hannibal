import type { TrustItem } from "@/shared/types";
import styles from "./TrustPill.module.css";

interface TrustPillStripProps {
  items: TrustItem[];
}

export const TrustPillStrip = ({ items }: TrustPillStripProps) => {
  return (
    <div className={styles.strip}>
      {items.map((item) => (
        <span key={item.label} className={styles.pill}>
          <span className={styles.dot} aria-hidden="true" />
          {item.label}
        </span>
      ))}
    </div>
  );
};
