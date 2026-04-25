import styles from "./Tag.module.css";

interface TagProps {
  label: string;
  className?: string;
}

export const Tag = ({ label, className = "" }: TagProps) => {
  return (
    <span className={[styles.tag, className].filter(Boolean).join(" ")}>
      {label}
    </span>
  );
};
