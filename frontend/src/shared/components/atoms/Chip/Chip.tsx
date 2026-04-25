import styles from "./Chip.module.css";

interface ChipProps {
  label: string;
  color: string;
}

export const Chip = ({ label, color }: ChipProps) => {
  return (
    <span className={styles.chip}>
      <span className={styles.bullet} style={{ background: color }} aria-hidden="true" />
      {label}
    </span>
  );
};
