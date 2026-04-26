import { StepCard } from "@/shared/components/molecules";
import type { HowStep } from "@/shared/types";
import styles from "./HowItWorksStrip.module.css";

const DEFAULT_STEPS: HowStep[] = [
  {
    num: "01 / SELECT",
    title: "Select the topic ",
    desc: '"Show me how OTP works."  scopes the build with you.',
    hasArrow: true,
  },
  {
    num: "02 / SKETCH",
    title: "Draw the system live",
    desc: "Diagrams, nodes, arrows. With the help of tutor",
    hasArrow: true,
  },
  {
    num: "03 / BUILD",
    title: "You ship it, in the browser",
    desc: "Code, run, break, refactor. Your system, your repo at the end.",
    hasArrow: false,
  },
];

interface HowItWorksStripProps {
  steps?: HowStep[];
}

export const HowItWorksStrip = ({ steps = DEFAULT_STEPS }: HowItWorksStripProps) => {
  return (
    <div className={styles.strip}>
      {steps.map((step) => (
        <StepCard key={step.num} step={step} />
      ))}
    </div>
  );
};
