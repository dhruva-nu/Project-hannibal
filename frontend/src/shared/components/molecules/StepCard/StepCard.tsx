import type { HowStep } from "@/shared/types";
import styles from "./StepCard.module.css";

const ArrowIcon = () => (
  <svg
    className={styles.arrow}
    width="22"
    height="22"
    viewBox="0 0 22 22"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d="M3 11h16M14 5l5 6-5 6" strokeDasharray="2 3" />
  </svg>
);

interface StepCardProps {
  step: HowStep;
}

export const StepCard = ({ step }: StepCardProps) => {
  return (
    <div className={styles.step}>
      <div className={styles.num}>{step.num}</div>
      <div className={styles.title}>{step.title}</div>
      <p className={styles.desc}>{step.desc}</p>
      {step.hasArrow && <ArrowIcon />}
    </div>
  );
};
