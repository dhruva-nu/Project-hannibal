import styles from "./Badge.module.css";

interface BadgeProps {
  label: string;
  showDot?: boolean;
  className?: string;
}

export const Badge = ({ label, showDot = true, className = "" }: BadgeProps) => {
  return (
    <div className={[styles.badge, className].filter(Boolean).join(" ")}>
      {showDot && <span className={styles.dot} aria-hidden="true" />}
      <span>{label}</span>
    </div>
  );
};
