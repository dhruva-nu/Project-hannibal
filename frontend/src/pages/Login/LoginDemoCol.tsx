import { AuthFlowDiagram } from "@/shared/components/organisms";
import styles from "./Login.module.css";

export const LoginDemoCol = () => (
  <div className={styles.demoCol}>
    <p className={styles.floatAnno} aria-hidden="true">
      what happens<br />when you sign in ↘
      <svg
        width="80"
        height="40"
        viewBox="0 0 80 40"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M5 8 Q 35 5, 60 25" strokeDasharray="4 4" />
        <path d="M52 18 L 62 26 L 56 30" />
      </svg>
    </p>
    <AuthFlowDiagram />
  </div>
);
