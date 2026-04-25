import styles from "./BrandMark.module.css";

interface BrandMarkProps {
  letters?: string;
}

export const BrandMark = ({ letters = "PH" }: BrandMarkProps) => {
  return (
    <div className={styles.mark} aria-hidden="true">
      {letters}
    </div>
  );
};
